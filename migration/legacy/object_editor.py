"""Object-local image adjustments. Never overwrite source assets."""
import copy, json, math, re, time, uuid
from PIL import Image, ImageDraw
import numpy as np

COLOR_FIELDS = {'person': ['Hair color','Eye color','Skin tone','Lips','Teeth color','Clothing'], 'car':['Paint color','Wheels color','Windows','Interior'], 'animal':['Fur / feathers','Eyes','Accessories'], 'object':['Surface color','Details'], 'background':['Background color','Details']}

def validate(recipe, problem):
    if not isinstance(recipe,dict) or recipe.get('version') != 1: raise problem('Invalid editor recipe')
    objects=recipe.get('objects')
    if not isinstance(objects,list) or not 1<=len(objects)<=12: raise problem('Add between 1 and 12 objects')
    if len(json.dumps(recipe))>900000: raise problem('Selection is too complex; simplify the masks')
    points=0
    def number(n,lo,hi):
        if isinstance(n,bool) or not isinstance(n,(int,float)) or not math.isfinite(n) or not lo<=n<=hi: raise problem('Invalid editor control value')
    for obj in objects:
        if not isinstance(obj,dict) or obj.get('type') not in COLOR_FIELDS: raise problem('Choose a supported object type')
        if not isinstance(obj.get('name'),str) or not 1<=len(obj['name'])<=100: raise problem('Give each object a name')
        bbox=obj.get('bounds')
        if bbox is not None:
            if not isinstance(bbox,list) or len(bbox)!=4: raise problem('Invalid object bounds')
            for n in bbox:number(n,0,1)
        attrs=obj.get('attributes',{})
        if not isinstance(attrs,dict) or len(attrs)>12: raise problem('Invalid object attributes')
        for key,attr in attrs.items():
            if key not in COLOR_FIELDS[obj['type']] or not isinstance(attr,dict): raise problem('Invalid color attribute')
            if not re.fullmatch(r'#[0-9a-fA-F]{6}',attr.get('color','')): raise problem('Invalid color')
            number(attr.get('amount'),0,100);number(attr.get('shade'),0,100)
            strokes=attr.get('strokes',[])
            if not isinstance(strokes,list) or len(strokes)>400:raise problem('Too many mask strokes')
            for stroke in strokes:
                if not isinstance(stroke,dict) or stroke.get('mode') not in ('paint','erase','rectangle'):raise problem('Invalid mask stroke')
                number(stroke.get('width'),0.001,0.3)
                pts=stroke.get('points')
                if not isinstance(pts,list) or not 1<=len(pts)<=5000:raise problem('Invalid stroke points')
                points+=len(pts)
                if points>30000:raise problem('Selection is too complex')
                for pt in pts:
                    if not isinstance(pt,list) or len(pt)!=2:raise problem('Invalid mask point')
                    for n in pt:number(n,0,1)
        ai=obj.get('ai',{})
        if not isinstance(ai,dict) or len(ai)>20 or any(not isinstance(k,str) or len(k)>100 or not isinstance(v,str) or len(v)>500 for k,v in ai.items()):raise problem('Invalid AI attributes')
    return copy.deepcopy(recipe)

def mask_for(strokes,size):
    w,h=size;mask=Image.new('L',size,0);d=ImageDraw.Draw(mask)
    for stroke in strokes:
        pts=[(round(p[0]*(w-1)),round(p[1]*(h-1))) for p in stroke['points']]
        color=0 if stroke['mode']=='erase' else 255
        if stroke['mode']=='rectangle':
            a,b=pts[0],pts[-1];d.rectangle((min(a[0],b[0]),min(a[1],b[1]),max(a[0],b[0]),max(a[1],b[1])),fill=color)
        else:
            width=max(1,round(stroke['width']*min(w,h)));r=width/2
            if len(pts)>1:d.line(pts,fill=color,width=width)
            for x,y in pts:d.ellipse((x-r,y-r,x+r,y+r),fill=color)
    return np.asarray(mask,dtype=np.float32)/255

def render(image,recipe):
    original=np.asarray(image.convert('RGBA'),dtype=np.float32);out=original.copy()
    for obj in recipe['objects']:
        for a in obj.get('attributes',{}).values():
            if not a['strokes'] or (a['amount']==0 and a['shade']==50):continue
            m=mask_for(a['strokes'],image.size)[...,None];src=out[:,:,:3]
            lum=(src[:,:,0]*.2126+src[:,:,1]*.7152+src[:,:,2]*.0722)/255
            rgb=np.array([int(a['color'][i:i+2],16) for i in (1,3,5)],dtype=np.float32)
            target=np.minimum(255,rgb[None,None,:]*(.4+.6*lum[...,None])+8*lum[...,None])
            changed=src+(target-src)*a['amount']/100
            shade=(a['shade']-50)/50
            changed=changed*(1-shade) if shade>=0 else changed+(255-changed)*(-shade)
            out[:,:,:3]=np.round(src+(changed-src)*m)
    return Image.fromarray(np.clip(out,0,255).astype('uint8'),'RGBA')

def save_copy(body,env):
    Problem=env['Problem'];source=env['get'](body.get('asset_id',''),'asset')
    if source.get('deleted') or source.get('media')!='image':raise Problem('Choose an image outside Trash')
    recipe=validate(body.get('recipe'),Problem)
    path=env['asset_path'](source)
    with Image.open(path) as image:
        if image.width*image.height>20000000:raise Problem('Editor supports images up to 20 megapixels')
        result=render(image,recipe)
    aid=uuid.uuid4().hex;rel=f'image-dev/{aid}.png';dest=env['DATA']/rel
    result.save(dest,'PNG')
    record=dict(id=aid,kind='asset',created=time.time(),media='image',stage='dev',story_id=source.get('story_id',env['LEGACY_STORY']),path=rel,prompt=source.get('prompt',''),title='Edited copy · '+source.get('title',source.get('prompt','Image'))[:100],settings={'model':'local-object-editor','width':result.width,'height':result.height,'steps':0},sync='pending',editor={'source_asset_id':source['id'],'recipe':recipe})
    return env['save'](record)
