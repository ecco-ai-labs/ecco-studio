"""Validate self-contained glTF binaries before importing them into Blender."""
import json
import struct
from pathlib import Path


def inspect(path):
    path = Path(path)
    size = path.stat().st_size
    if not 20 <= size <= 512 * 1024 * 1024:
        raise ValueError('GLB size must be between 20 bytes and 512 MB.')
    with path.open('rb') as source:
        magic, version, length = struct.unpack('<4sII', source.read(12))
        if magic != b'glTF' or version != 2 or length != size:
            raise ValueError('Invalid GLB container.')
        count, kind = struct.unpack('<II', source.read(8))
        if kind != 0x4e4f534a or not 2 <= count <= min(32 * 1024 * 1024, size - 20):
            raise ValueError('Invalid GLB metadata.')
        doc = json.loads(source.read(count))
    if doc.get('asset', {}).get('version') != '2.0' or not doc.get('meshes'):
        raise ValueError('GLB must contain a glTF 2.0 mesh.')
    if len(doc.get('nodes', [])) > 10000 or len(doc.get('meshes', [])) > 1000:
        raise ValueError('GLB exceeds the character scene limits.')
    for accessor in doc.get('accessors', []):
        if type(accessor.get('count')) != int or not 0 <= accessor['count'] <= 12000000:
            raise ValueError('GLB accessor size is invalid.')
    for view in doc.get('bufferViews', []):
        if type(view.get('byteLength')) != int or not 0 <= view['byteLength'] <= size:
            raise ValueError('GLB buffer size is invalid.')
    for item in doc.get('buffers', []) + doc.get('images', []):
        if 'uri' in item: raise ValueError('GLB must embed all geometry and textures; external resources are not accepted.')
    if any('KHR_draco_mesh_compression' in p.get('extensions', {}) for m in doc['meshes'] for p in m.get('primitives', [])):
        raise ValueError('Export uncompressed GLB for Blender import.')
    skins = doc.get('skins', [])
    skinned = any(type(n.get('skin')) == int and 0 <= n['skin'] < len(skins) and 'mesh' in n for n in doc.get('nodes', []))
    weights = any('WEIGHTS_0' in p.get('attributes', {}) and 'JOINTS_0' in p.get('attributes', {})
                  for m in doc['meshes'] for p in m.get('primitives', []))
    return {'skinned': bool(skinned and weights), 'meshes': len(doc['meshes']),
            'materials': len(doc.get('materials', [])), 'textures': len(doc.get('textures', []))}
