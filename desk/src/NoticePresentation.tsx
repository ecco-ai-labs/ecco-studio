export type Presentation={placements:string[];badge:string};
export const presentationDefaults=(promotional=false):Presentation=>({placements:promotional?['bell','billing']:['bell'],badge:'NEW'});
export default function NoticePresentation({value,onChange,promotional=false,ready=true}:{value:Presentation;onChange:(next:Presentation)=>void;promotional?:boolean;ready?:boolean}){
 const presets=['NEW','Dhamaka','Limited Time'];const custom=!presets.includes(value.badge);
 return <fieldset className="notice-presentation" disabled={!ready}><legend>Show in</legend><div className="notice-locations">{[['bell','Bell Icon'],['billing','Billing']].map(([id,label])=><label key={id}><input type="checkbox" aria-label={label} checked={value.placements.includes(id)} onChange={e=>onChange({...value,placements:e.target.checked?[...value.placements,id]:value.placements.filter(p=>p!==id)})}/><span>{label}<small>{id==='bell'?'User notification list':'Above regular credit options'}</small></span></label>)}</div>
 {!value.placements.length&&<p className="inline-error" role="alert">Choose at least one display location.</p>}
 {!ready&&<p className="form-info">Display options require the notification service update.</p>}
 {promotional&&<div className="notice-badge-controls"><label>Icon<select aria-label="Icon" value={custom?'custom':value.badge} onChange={e=>onChange({...value,badge:e.target.value==='custom'?'':e.target.value})}>{presets.map(p=><option key={p}>{p}</option>)}<option value="custom">Custom text</option></select></label>{custom&&<label>Icon text<input aria-label="Icon text" required maxLength={20} value={value.badge} onChange={e=>onChange({...value,badge:e.target.value})}/></label>}<span className="notice-badge" aria-label={'Icon preview: '+(value.badge||'Custom text')}>{value.badge||'Your icon'}</span></div>}
 </fieldset>;
}
