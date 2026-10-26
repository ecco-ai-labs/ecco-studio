"""Optional Blender UI for reviewing a generated character's body mapping."""
bl_info = {'name': 'Ecco Studio Character', 'author': 'Ecco AI Labs', 'version': (1, 0, 0),
           'blender': (4, 2, 0), 'location': 'View3D > Sidebar > Ecco', 'category': 'Animation'}
import bpy
import json

CONTROLS = ('hips', 'spine', 'head', 'left_arm', 'right_arm', 'left_forearm', 'right_forearm',
            'left_thigh', 'right_thigh', 'left_shin', 'right_shin', 'left_foot', 'right_foot')


class ECCO_OT_mapping(bpy.types.Operator):
    bl_idname = 'ecco.save_character_mapping'
    bl_label = 'Save Body Mapping'
    bl_options = {'REGISTER', 'UNDO'}

    def execute(self, context):
        arm = context.object
        if not arm or arm.type != 'ARMATURE': return {'CANCELLED'}
        mapping = {key: getattr(context.scene, 'ecco_' + key) for key in CONTROLS}
        if any(name and name not in arm.data.bones for name in mapping.values()):
            self.report({'ERROR'}, 'Choose bones from the selected armature.')
            return {'CANCELLED'}
        arm['ecco_bone_map'] = json.dumps({k: v for k, v in mapping.items() if v})
        self.report({'INFO'}, 'Mapping saved. Export GLB with Custom Properties enabled to import into Studio.')
        return {'FINISHED'}


class ECCO_PT_character(bpy.types.Panel):
    bl_label = 'Ecco Studio Character'
    bl_idname = 'ECCO_PT_character'
    bl_space_type = 'VIEW_3D'
    bl_region_type = 'UI'
    bl_category = 'Ecco'

    def draw(self, context):
        layout = self.layout
        arm = context.object
        if not arm or arm.type != 'ARMATURE':
            layout.label(text='Select the character armature.')
            return
        for key in CONTROLS:
            layout.prop_search(context.scene, 'ecco_' + key, arm.data, 'bones', text=key.replace('_', ' ').title())
        layout.operator('ecco.save_character_mapping')
        layout.label(text='Facial shape keys: smile, angry, fear')
        layout.label(text='Create and review these on the face mesh.')
        layout.label(text='Export GLB with skin, morphs and Custom Properties.')


def register():
    for key in CONTROLS: setattr(bpy.types.Scene, 'ecco_' + key, bpy.props.StringProperty())
    bpy.utils.register_class(ECCO_OT_mapping)
    bpy.utils.register_class(ECCO_PT_character)


def unregister():
    bpy.utils.unregister_class(ECCO_PT_character)
    bpy.utils.unregister_class(ECCO_OT_mapping)
    for key in CONTROLS: delattr(bpy.types.Scene, 'ecco_' + key)


if __name__ == '__main__': register()
