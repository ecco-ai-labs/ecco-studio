"""Helpers shared by the serverless GPU workers (runs inside the worker containers).

Inputs arrive as base64 files in the job input. Outputs leave as one tar archive:
uploaded to an S3-compatible bucket when one is configured (needed for video
frames), otherwise returned inline when small enough.

Bucket settings (RunPod endpoint secrets):
  ECCO_S3_BUCKET, ECCO_S3_ENDPOINT_URL, ECCO_S3_ACCESS_KEY_ID, ECCO_S3_SECRET_ACCESS_KEY
"""
import base64
import io
import os
import tarfile
from pathlib import Path, PurePosixPath

MAX_INLINE_BYTES = int(os.getenv('ECCO_MAX_INLINE_BYTES', str(7 * 1024 * 1024)))


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


def bucket_configured():
    return all(os.getenv(k) for k in ('ECCO_S3_BUCKET', 'ECCO_S3_ENDPOINT_URL',
                                      'ECCO_S3_ACCESS_KEY_ID', 'ECCO_S3_SECRET_ACCESS_KEY'))


def deliver(data, key):
    """Return {'url': presigned GET} via the bucket, or {'inline': base64} when small."""
    if bucket_configured():
        import boto3
        client = boto3.client('s3', endpoint_url=os.environ['ECCO_S3_ENDPOINT_URL'],
                              aws_access_key_id=os.environ['ECCO_S3_ACCESS_KEY_ID'],
                              aws_secret_access_key=os.environ['ECCO_S3_SECRET_ACCESS_KEY'],
                              region_name=os.getenv('ECCO_S3_REGION', 'auto'))
        bucket = os.environ['ECCO_S3_BUCKET']
        client.put_object(Bucket=bucket, Key=key, Body=data)
        url = client.generate_presigned_url('get_object', Params={'Bucket': bucket, 'Key': key}, ExpiresIn=6 * 3600)
        return {'url': url, 'bytes': len(data)}
    if len(data) > MAX_INLINE_BYTES:
        raise RuntimeError('Result is too large to return inline. Configure the ECCO_S3_* bucket secrets on this endpoint.')
    return {'inline': base64.b64encode(data).decode(), 'bytes': len(data)}
