const {test}=require('node:test');
const assert=require('node:assert/strict');
const M=require('./story-workspace-model.js');
const cast=[{id:'m',name:'Maya',role:'Host',voice:'a',description:'',personality:''},{id:'d',name:'Dev',role:'Guest',voice:'b',description:'',personality:''}];
const strip=plan=>[...(plan.opening?[plan.opening]:[]),...plan.segments].map(s=>[s.character_id,s.text,s.performance?.direction||'']);

test('One turn per line splits into turns, as blank-line paragraphs do',()=>{
 const oneLine=M.parseScript('Maya [curious]: What if a jet starves its own black hole?\nDev: That is the idea.\nMaya: A campfire blowing away its own firewood.\nDev [laughing]: Yes!',cast);
 const paragraphs=M.parseScript('Maya [curious]: What if a jet starves its own black hole?\n\nDev: That is the idea.\n\nMaya: A campfire blowing away its own firewood.\n\nDev [laughing]: Yes!',cast);
 assert.deepEqual(strip(oneLine),strip(paragraphs));
 assert.deepEqual(strip(oneLine).map(s=>s[0]),['m','d','m','d']);
 assert.equal(strip(oneLine)[3][2],'laughing');
 assert.ok(strip(oneLine).every(s=>!/Maya:|Dev:|\[/.test(s[1])),'speaker labels and cues never reach spoken text');
});

test('A wrapped line without a name stays with the same speaker; sound lines split',()=>{
 const plan=M.parseScript('Maya: This sentence is long\nand wraps onto a second line.\n[Sound: soft chime]\nDev: Got it.',cast);
 assert.deepEqual(strip(plan).map(s=>s[0]),['m','d']);
 assert.match(strip(plan)[0][1],/long and wraps/);
});

test('Words that only look like a label inside a turn do not split it',()=>{
 const plan=M.parseScript('Maya: Note: this stays with Maya.\nDev: Fine.',cast);
 assert.deepEqual(strip(plan).map(s=>s[0]),['m','d']);
 assert.match(strip(plan)[0][1],/Note: this stays/);
});

test('Script rules: repeated or late introductions, labels in words and the sound-cue turn limit',()=>{
 global.window={EccoAudioDirection:{emotions:['neutral']}};delete require.cache[require.resolve('./audio-script-review.js')];require('./audio-script-review.js');
 const R=global.window.EccoScriptReview,seg=(id,text)=>({character_id:id,text});
 const twice={opening:null,segments:[seg('m','What if a jet starves its black hole?'),seg('d','That is the idea.'),seg('m','Welcome to the show, I am Maya.'),seg('d','Thanks.'),seg('m','Welcome back to the show.')]};
 assert.match(R.checks(twice,cast,{storyType:'podcast'}).issues.find(i=>i.severity==='block').problem,/introduced more than once/);
 const late={opening:null,segments:[seg('m','What if?'),seg('d','Indeed.'),seg('m','Ha.'),seg('d','So.'),seg('m','Welcome to the show.')]};
 assert.match(R.checks(late,cast,{storyType:'podcast'}).issues[0].problem,/after the conversation has started/);
 const good={opening:null,segments:[seg('m','Welcome to the show. I am Maya, and with me is Dev.'),seg('d','Thanks for having me.'),seg('m','So, what is a jet?')]};
 assert.deepEqual(R.checks(good,cast,{storyType:'podcast'}).issues,[]);
 assert.ok(R.checks({opening:null,segments:[seg('m','Maya: hello [laughs]')]},cast,{storyType:'podcast'}).issues.length>=2);
 const long={opening:null,segments:Array.from({length:85},(_,i)=>seg(i%2?'d':'m','Line '+i+'.'))};
 assert.equal(R.checks(long,cast,{storyType:'podcast'}).issues.filter(i=>i.severity==='block').length,0,'long recordings without sounds are fine');
 assert.match(R.checks(long,cast,{storyType:'podcast',sounds:2}).issues[0].problem,/at most 80 turns/);
 assert.equal(R.checks(good,cast,{storyType:'storybook'}).minutes,Math.round(R.checks(good,cast,{storyType:'storybook'}).words/115*10)/10);
});
