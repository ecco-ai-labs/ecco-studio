"""Trusted Blender 4.2+ scene builder. Inputs are GLB + bounded JSON, never code."""
import json
import math
from pathlib import Path
import re
import sys

import bpy
from mathutils import Vector

ALIASES = {
    'hips': ('hips', 'pelvis'), 'spine': ('spine', 'spine1'), 'head': ('head',),
    'left_arm': ('leftarm', 'upperarml', 'upperarml01'),
    'right_arm': ('rightarm', 'upperarmr', 'upperarmr01'),
    'left_forearm': ('leftforearm', 'forearml', 'lowerarml'),
    'right_forearm': ('rightforearm', 'forearmr', 'lowerarmr'),
    'left_thigh': ('leftupleg', 'thighl', 'leftthigh'),
    'right_thigh': ('rightupleg', 'thighr', 'rightthigh'),
    'left_shin': ('leftleg', 'shinl', 'calfl', 'lowerlegl'),
    'right_shin': ('rightleg', 'shinr', 'calfr', 'lowerlegr'),
    'left_foot': ('leftfoot', 'footl'), 'right_foot': ('rightfoot', 'footr'),
}
REQUIRED = ('hips', 'left_arm', 'right_arm', 'left_thigh', 'right_thigh', 'left_shin', 'right_shin')


def normalized(name):
    return re.sub('[^a-z0-9]', '', name.lower().split(':')[-1].replace('mixamorig', '').removeprefix('def-'))


def bone_map(armature):
    explicit = armature.get('ecco_bone_map', '{}')
    if isinstance(explicit, str):
        try: explicit = json.loads(explicit)
        except ValueError: explicit = {}
    result = {}
    for semantic, names in ALIASES.items():
        name = explicit.get(semantic) if hasattr(explicit, 'get') else None
        if name in armature.pose.bones:
            result[semantic] = name
        else:
            found = [b.name for b in armature.pose.bones if normalized(b.name) in names]
            if len(found) == 1: result[semantic] = found[0]
    return result


def facial_keys(meshes):
    result = {}
    for expression in ('smile', 'angry', 'fear'):
        keys = []
        for obj in meshes:
            if not obj.data.shape_keys: continue
            for key in obj.data.shape_keys.key_blocks:
                if normalized(key.name) in (expression, 'eccoface' + expression):
                    keys.append((obj, key))
        if keys: result[expression] = keys
    return result


def rig_report(armature, meshes):
    if not armature: return {'skinned': False, 'actions': [], 'expressions': ['neutral']}
    mapped = bone_map(armature)
    skinned = bool(any(m.type == 'ARMATURE' and m.object == armature and len(o.vertex_groups)
                       for o in meshes for m in o.modifiers))
    complete = all(k in mapped for k in REQUIRED)
    return {'skinned': skinned, 'bone_count': len(armature.data.bones), 'bone_map': mapped,
            'missing_controls': [k for k in REQUIRED if k not in mapped],
            'actions': ['stand', 'sit', 'run', 'jump', 'kick'] if complete else ['stand'],
            'expressions': ['neutral'] + list(facial_keys(meshes)),
            'motion_quality': 'procedural_preview',
            'facial_status': 'available' if facial_keys(meshes) else 'needs_facial_shape_keys'}


def animate(armature, meshes, root, params, height, report):
    action, expression = params['action'], params['expression']
    if action not in report['actions'] or expression not in report['expressions']:
        raise ValueError('The rig does not support the selected action or facial expression.')
    mapping = report['bone_map']
    frames = max(2, round(params['seconds'] * 24))
    bpy.context.scene.frame_end = frames
    neutral = {b.name: b.rotation_quaternion.copy() for b in armature.pose.bones}
    for bone in armature.pose.bones: bone.rotation_mode = 'XYZ'
    root_z = root.location.z
    for frame in range(1, frames + 1):
        time = (frame - 1) / 24
        phase = time * math.tau * 2
        rotations = {}
        vertical = 0
        if action == 'run':
            for side, sign in (('left', 1), ('right', -1)):
                swing = math.sin(phase) * sign
                rotations[side + '_thigh'] = swing * .65
                rotations[side + '_shin'] = max(0, -swing) * 1.25
                rotations[side + '_arm'] = -swing * .6
                rotations[side + '_forearm'] = -.8
            rotations['spine'] = .12
            vertical = height * .025 * abs(math.sin(phase))
        elif action == 'sit':
            amount = min(1, time / .8)
            for side in ('left', 'right'):
                rotations[side + '_thigh'] = -math.pi / 2 * amount
                rotations[side + '_shin'] = math.pi / 2 * amount
            vertical = -height * .25 * amount
        elif action == 'jump':
            cycle = min(1, (frame - 1) / (frames - 1))
            lift = max(0, math.sin(math.pi * cycle))
            vertical = height * .3 * lift
            for side in ('left', 'right'):
                rotations[side + '_thigh'] = -.35 * lift
                rotations[side + '_shin'] = .7 * lift
                rotations[side + '_arm'] = -1.3 * lift
        elif action == 'kick':
            amount = math.sin(math.pi * (frame - 1) / (frames - 1)) ** 2
            rotations['right_thigh'] = -1.35 * amount
            rotations['right_shin'] = .35 * amount
            rotations['left_arm'] = -.4 * amount
        for semantic, name in mapping.items():
            bone = armature.pose.bones[name]
            bone.rotation_euler = neutral[name].to_euler('XYZ')
            bone.rotation_euler.x += rotations.get(semantic, 0)
            bone.keyframe_insert('rotation_euler', frame=frame)
        root.location.z = root_z + vertical
        root.keyframe_insert('location', frame=frame)
    for name, keys in facial_keys(meshes).items():
        for obj, key in keys:
            key.value = 1 if name == expression else 0
            key.keyframe_insert('value', frame=1)
            key.keyframe_insert('value', frame=frames)
    return frames


def aim(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat('-Z', 'Y').to_euler()


def scene(task, test_settings=None):
    output = Path(task['output_dir'])
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    bpy.ops.import_scene.gltf(filepath=task['model_path'])
    objects = list(bpy.context.scene.objects)
    meshes = [o for o in objects if o.type == 'MESH']
    arms = [o for o in objects if o.type == 'ARMATURE']
    if not meshes: raise ValueError('The GLB contains no mesh.')
    if len(arms) > 1: raise ValueError('Use one character armature per GLB.')
    arm = arms[0] if arms else None
    report = rig_report(arm, meshes)
    if task['stage'] in ('rig', 'performance') and not report['skinned']:
        raise ValueError('No valid skinned body rig was found.')
    # Preserve original geometry and textures. Camera and motion are separate.
    root = bpy.data.objects.new('Ecco Character', None)
    bpy.context.collection.objects.link(root)
    for obj in objects:
        if obj.parent is None: obj.parent = root
    bpy.context.view_layer.update()
    corners = [obj.matrix_world @ Vector(v) for obj in meshes for v in obj.bound_box]
    lower = Vector(tuple(min(p[i] for p in corners) for i in range(3)))
    upper = Vector(tuple(max(p[i] for p in corners) for i in range(3)))
    height = upper.z - lower.z
    if height <= 1e-6: raise ValueError('Model has no measurable height.')
    center = (lower + upper) / 2
    root.location.z -= lower.z
    center.z -= lower.z
    render = bpy.context.scene
    render.render.engine = 'CYCLES'
    device = task.get('render_device', 'CPU')
    if device not in ('CPU', 'CUDA', 'OPTIX'): raise ValueError('Unsupported Blender render device.')
    if device != 'CPU':
        prefs = bpy.context.preferences.addons['cycles'].preferences
        prefs.compute_device_type = device
        prefs.get_devices()
        selected = [d for d in prefs.devices if d.type == device]
        if not selected: raise ValueError('Requested Blender GPU device is unavailable; no CPU fallback was used.')
        for d in prefs.devices: d.use = d in selected
        render.cycles.device = 'GPU'
    render.cycles.samples = 32
    render.cycles.use_denoising = True
    render.render.fps = 24
    high = task['params'].get('quality') == 'high'
    render.render.resolution_x = 1920 if high else 768
    render.render.resolution_y = 1080 if high else 768
    render.render.resolution_percentage = 100
    if test_settings:
        render.render.resolution_x = render.render.resolution_y = test_settings['size']
        render.cycles.samples = test_settings['samples']
    render.render.image_settings.file_format = 'PNG'
    render.world.color = (.12, .12, .12)
    render.view_settings.view_transform = 'AgX'
    bpy.ops.object.camera_add()
    camera = bpy.context.object
    render.camera = camera
    camera.data.type = 'ORTHO'
    camera.data.ortho_scale = height * 2.25
    angle = {'front': 0, 'three-quarter': math.pi / 4, 'side': math.pi / 2}.get(task['params'].get('camera'), 0)
    camera.location = center + Vector((math.sin(angle) * height * 3, -math.cos(angle) * height * 3, height * .12))
    aim(camera, center)
    for name, position, power in [('Key', (-2, -3, 4), 1500), ('Fill', (3, -1, 2), 900), ('Rim', (0, 2, 3), 1800)]:
        bpy.ops.object.light_add(type='AREA', location=center + Vector(position) * height)
        light = bpy.context.object
        light.name = name
        light.data.energy = power * height ** 2
        light.data.shape = 'DISK'
        light.data.size = height * 2
        aim(light, center)
    bpy.ops.mesh.primitive_plane_add(size=height * 200, location=(center.x, center.y, -.005 * height))
    floor = bpy.context.object
    floor.name = 'Studio Floor'
    material = bpy.data.materials.new('Studio Neutral')
    material.diffuse_color = (.12, .14, .18, 1)
    floor.data.materials.append(material)
    files = []
    if task['stage'] == 'performance':
        animate(arm, meshes, root, task['params'], height, report)
        render.frame_set(max(1, render.frame_end // 2))
    else:
        render.frame_set(1)
        role = 'model' if task['stage'] == 'model' else 'rig'
        if role == 'rig':
            bpy.ops.object.select_all(action='DESELECT')
            for obj in objects + [root]: obj.select_set(True)
            bpy.ops.export_scene.gltf(filepath=str(output / 'rig.glb'), export_format='GLB',
                                      use_selection=True, export_extras=True)
        files.append({'name': role + '.glb', 'role': role})
    render.render.filepath = str(output / 'still.png')
    bpy.ops.render.render(write_still=True)
    files.append({'name': 'still.png', 'role': 'still'})
    bpy.ops.file.pack_all()
    bpy.ops.wm.save_as_mainfile(filepath=str(output / 'character.blend'))
    files.append({'name': 'character.blend', 'role': 'blend'})
    if task['stage'] == 'performance' and task['params'].get('output') == 'clip':
        render.render.image_settings.file_format = 'FFMPEG'
        render.render.ffmpeg.format = 'MPEG4'
        render.render.ffmpeg.codec = 'H264'
        render.render.ffmpeg.constant_rate_factor = 'HIGH'
        render.render.filepath = str(output / 'performance.mp4')
        bpy.ops.render.render(animation=True)
        files.append({'name': 'performance.mp4', 'role': 'clip'})
    (output / 'manifest.json').write_text(json.dumps({'files': files, 'rig_report': report,
        'geometry': {'vertices': sum(len(o.data.vertices) for o in meshes),
                     'faces': sum(len(o.data.polygons) for o in meshes)},
        'textures': [{'name': i.name, 'width': i.size[0], 'height': i.size[1]}
                     for i in bpy.data.images if i.type == 'IMAGE' and i.size[0]]}, indent=2))


if __name__ == '__main__':
    scene(json.loads(Path(sys.argv[sys.argv.index('--') + 1]).read_text()))
