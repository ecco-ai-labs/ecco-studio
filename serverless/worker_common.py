"""Helpers shared by the serverless GPU workers (runs inside the worker containers).

Inputs arrive as base64 files in the job input. Outputs leave as one tar archive,
uploaded through RunPod's S3-compatible API onto the shared network volume, so
the CPU pod finds it on its own disk under /workspace/<key>. Small results are
returned inline when the volume API is not configured.

Endpoint secrets (RunPod S3 API key for the network volume):
  ECCO_S3_ENDPOINT_URL      e.g. https://s3api-eu-ro-1.runpod.io/
  ECCO_S3_REGION            e.g. eu-ro-1
  ECCO_S3_BUCKET            the network volume ID, e.g. b3qo8lps92
  ECCO_S3_ACCESS_KEY_ID, ECCO_S3_SECRET_ACCESS_KEY
"""
import base64
import io
import os
import tarfile
from pathlib import Path, PurePosixPath

MAX_INLINE_BYTES = int(os.getenv('ECCO_MAX_INLINE_BYTES', str(7 * 1024 * 1024)))
RESULTS_PREFIX = 'ecco-serverless/results/'


def safe_name(name):
    path = PurePosixPath(str(name))
    if path.is_absolute() or '..' in path.parts or not path.parts:
        raise ValueError(f'Unsafe file name: {name!r}')
    return str(path)


def write_inputs(files, directory):
    """Write [{'name': ..., 'data': base64}] into directory. Returns written paths."""
    directory = Path(directory)
    written = []
    for item in files or []:
        target = directory / safe_name(item['name'])
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(base64.b64decode(item['data'], validate=True))
        written.append(target)
    return written


def pack(paths, base):
    """Tar the given files with names relative to base."""
    buffer = io.BytesIO()
    base = Path(base)
    with tarfile.open(fileobj=buffer, mode='w') as archive:
        for path in paths:
            archive.add(str(path), arcname=str(Path(path).relative_to(base)))
    return buffer.getvalue()


def volume_configured():
    return all(os.getenv(k) for k in ('ECCO_S3_BUCKET', 'ECCO_S3_ENDPOINT_URL',
                                      'ECCO_S3_ACCESS_KEY_ID', 'ECCO_S3_SECRET_ACCESS_KEY'))


def _s3_client():
    import boto3
    return boto3.client('s3', endpoint_url=os.environ['ECCO_S3_ENDPOINT_URL'],
                        aws_access_key_id=os.environ['ECCO_S3_ACCESS_KEY_ID'],
                        aws_secret_access_key=os.environ['ECCO_S3_SECRET_ACCESS_KEY'],
                        region_name=os.getenv('ECCO_S3_REGION', 'eu-ro-1'))


INPUTS_PREFIX = 'ecco-serverless/inputs/'


def fetch(ref):
    """Bytes of a job input given as {'volume_key': key on the network volume} or {'inline': base64}."""
    if ref.get('inline'):
        return base64.b64decode(ref['inline'], validate=True)
    key = safe_name(ref.get('volume_key', ''))
    if not key.startswith(INPUTS_PREFIX):
        raise ValueError('Job inputs must come from the serverless inputs folder.')
    buffer = io.BytesIO()
    _s3_client().download_fileobj(os.environ['ECCO_S3_BUCKET'], key, buffer)
    return buffer.getvalue()


def unpack_inputs(data, directory):
    """Extract a tar of plain files into directory, rejecting links and paths outside it."""
    directory = Path(directory).resolve()
    with tarfile.open(fileobj=io.BytesIO(data), mode='r') as archive:
        for member in archive.getmembers():
            target = (directory / safe_name(member.name)).resolve()
            if not member.isfile() or not target.is_relative_to(directory):
                raise ValueError(f'Unsafe input file: {member.name!r}')
            target.parent.mkdir(parents=True, exist_ok=True)
            with archive.extractfile(member) as source:
                target.write_bytes(source.read())


def deliver(data, name, inline=False):
    """Return {'volume_key': path on the volume} or {'inline': base64} when small.

    inline=True (a test job's "return_inline") skips the volume for small results.
    """
    if volume_configured() and not (inline and len(data) <= MAX_INLINE_BYTES):
        from boto3.s3.transfer import TransferConfig
        client = _s3_client()
        key = RESULTS_PREFIX + safe_name(name)
        # The volume API takes single uploads under 500 MB; larger ones go in parts.
        config = TransferConfig(multipart_threshold=256 * 1024 * 1024, multipart_chunksize=256 * 1024 * 1024)
        client.upload_fileobj(io.BytesIO(data), os.environ['ECCO_S3_BUCKET'], key, Config=config)
        return {'volume_key': key, 'bytes': len(data)}
    if len(data) > MAX_INLINE_BYTES:
        raise RuntimeError('Result is too large to return inline. Add the ECCO_S3_* volume secrets to this endpoint.')
    return {'inline': base64.b64encode(data).decode(), 'bytes': len(data)}
