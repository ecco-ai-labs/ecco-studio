"""Blender integration test with an explicitly synthetic fixture, not a demo actor.
Run with Blender --background --factory-startup --python-exit-code 1 --python
characters/smoke_blender.py -- /absolute/temporary/output
"""
import json
from pathlib import Path
import sys
import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent))
import blender_scene

root = Path(sys.argv[sys.argv.index('--') + 1])
root.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
bpy.ops.object.armature_add()
arm = bpy.context.object
arm.name = 'Test armature'
bpy.ops.object.mode_set(mode='EDIT')
arm.data.edit_bones.remove(arm.data.edit_bones[0])
bones = {'hips': ((0,0,1),(0,0,1.3)), 'spine': ((0,0,1.3),(0,0,1.7)), 'head': ((0,0,1.7),(0,0,2.1)),
 'left_arm': ((.15,0,1.6),(.7,0,1.6)), 'right_arm': ((-.15,0,1.6),(-.7,0,1.6)),
 'left_forearm': ((.7,0,1.6),(1,0,1.6)), 'right_forearm': ((-.7,0,1.6),(-1,0,1.6)),
 'left_thigh': ((.15,0,1),(.15,0,.55)), 'right_thigh': ((-.15,0,1),(-.15,0,.55)),
 'left_shin': ((.15,0,.55),(.15,0,.1)), 'right_shin': ((-.15,0,.55),(-.15,0,.1)),
 'left_foot': ((.15,0,.1),(.15,-.2,.1)), 'right_foot': ((-.15,0,.1),(-.15,-.2,.1))}
for name,(head,tail) in bones.items():
 b=arm.data.edit_bones.new(name);b.head=head;b.tail=tail
for name in bones:
 if name!='hips': arm.data.edit_bones[name].parent=arm.data.edit_bones['hips']
bpy.ops.object.mode_set(mode='OBJECT')
arm['ecco_bone_map']=json.dumps({k:k for k in bones})
for name,(head,tail) in bones.items():
 position=tuple((a+b)/2 for a,b in zip(head,tail))
 bpy.ops.mesh.primitive_cube_add(size=1,location=position)
 obj=bpy.context.object;obj.name='Fixture '+name
 obj.scale=(.15,.15,.18);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
 obj.parent=arm
 group=obj.vertex_groups.new(name=name);group.add(list(range(len(obj.data.vertices))),1,'REPLACE')
 modifier=obj.modifiers.new('Skin','ARMATURE');modifier.object=arm
 if name=='head':
  obj.shape_key_add(name='Basis');key=obj.shape_key_add(name='fear')
  key.data[0].co.z+=.03
bpy.ops.export_scene.gltf(filepath=str(root/'fixture.glb'),export_format='GLB',export_extras=True)
task={'id':'0'*32,'stage':'performance','model_path':str(root/'fixture.glb'),'output_dir':str(root),
      'params':{'quality':'preview','seconds':1,'action':'run','expression':'fear','camera':'three-quarter','output':'clip'}}
# Use the real scene/export/animation path, reducing render cost only in this test.
blender_scene.scene(task, {'size':96,'samples':1})
manifest=json.loads((root/'manifest.json').read_text())
assert manifest['rig_report']['skinned']
assert 'fear' in manifest['rig_report']['expressions']
assert set(manifest['rig_report']['actions'])=={'stand','sit','run','jump','kick'}
for name in ('character.blend','still.png','performance.mp4'): assert (root/name).stat().st_size>100
arm=next(o for o in bpy.context.scene.objects if o.type=='ARMATURE')
assert arm.animation_data and arm.animation_data.action
assert len(arm.animation_data.action.fcurves)>6
print('ECCO_BLENDER_SMOKE_PASSED')
