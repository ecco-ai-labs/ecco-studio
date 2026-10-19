import hashlib
import uuid
STYLES={'default':'','cartoon':'Cartoon illustration, expressive shapes and clean stylized lines.','animation':'Stylized 3D animated film, cinematic lighting and detailed materials.','origami':'Origami paper art, folded paper forms, crisp creases and paper texture.','clay':'Clay animation aesthetic, handcrafted clay figures and tactile sculpted textures.','human':'Photorealistic human subjects, natural skin texture and realistic anatomy.','photo':'Photorealistic photography, natural detail and realistic lighting.','anime':'Anime illustration, expressive character design and cel shading.','watercolor':'Watercolor painting, translucent washes and textured paper.','oil':'Oil painting, visible brushwork and rich pigments.','pixel':'Pixel art, crisp pixel grid and limited color palette.'}
def prepare_image(body,env):
    body=dict(body);style=body.get('image_style','default')
    if style not in STYLES:raise env['Problem']('Choose a supported image style')
    raw=env['text'](body.get('prompt'))
    body['source_prompt']=raw;body['image_style']=style
    body['prompt']=raw+('\nVisual style: '+STYLES[style] if STYLES[style] else '')
    return body

def create_folder(body,env):
    name=str(body.get('name','')).strip()
    if not name or len(name)>80:raise env['Problem']('Folder name must contain 1–80 characters')
    with env['LOCK']:
        existing = env['records']('image_folder')
        for folder in existing:
            if folder['name'].casefold() == name.casefold(): return folder
        fid = hashlib.sha256(('image-folder:' + name.casefold()).encode()).hexdigest()[:32]
        if any(folder['id'] == fid for folder in existing): fid = uuid.uuid4().hex
        return env['save'](dict(id=fid,kind='image_folder',created=env['time'].time(),name=name))

def save_to_folder(body,env):
    a=env['get'](body.get('asset_id',''),'asset');f=env['get'](body.get('folder_id',''),'image_folder')
    if a.get('deleted') or a.get('media')!='image':raise env['Problem']('Choose an image outside Trash')
    title=body.get('title')
    if title is not None:
        title=str(title).strip()
        if not title or len(title)>160:raise env['Problem']('Image name must contain 1–160 characters')
        a['title']=title;env['save'](a)
    rid=hashlib.sha256(('library-item:'+a['id']+':'+f['id']).encode()).hexdigest()[:32]
    return env['save'](dict(id=rid,kind='library_item',created=env['time'].time(),asset_id=a['id'],folder_id=f['id'],image_title=a.get('title','')))

