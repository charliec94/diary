import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createAutosaver,createDraftStore,onThisDay,newId} from '../public/journal-utils.js';
import {sections} from '../public/sections.js';

function storage(){const values=new Map();return{get length(){return values.size;},key:i=>[...values.keys()][i],getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};}
function timers(){const pending=new Map();let id=0;return{setTimeout:(fn,ms)=>{pending.set(++id,{fn,ms});return id;},clearTimeout:key=>pending.delete(key),get count(){return pending.size;},next(){const [key,value]=[...pending][0];pending.delete(key);value.fn();},get delay(){return [...pending.values()][0]?.ms;}};}
const blank={title:'',content:'',section:'journal',topic:'',date:'2026-09-10',chapter:'',mood:'',tags:'',favorite:false};
const written={...blank,content:'A thought worth keeping.'};
const result=(payload,updated='2026-09-10T00:00:00.001Z')=>({...payload,updated,created:updated});
function fixture(overrides={}){const clock=timers();const store=createDraftStore(storage());const states=[];const calls=[];const saver=createAutosaver({initial:blank,targetId:newId(),draftKey:'test',uuid:newId,store,timers:clock,onState:s=>states.push(s),request:async(url,options)=>{calls.push({url,...options});return result(JSON.parse(options.body));},...overrides});return{saver,clock,store,states,calls};}

test('autosave waits for a pause, creates one untitled entry, and clears recovery after acknowledgment',async()=>{
  const f=fixture();f.saver.update({...written,content:'first'});f.saver.update(written);
  assert.equal(f.calls.length,0);assert.equal(f.clock.count,1);assert.equal(f.clock.delay,1200);
  assert.equal(f.store.list()[0].latest.content,written.content);
  f.clock.next();await f.saver.flush();
  assert.equal(f.calls.length,1);assert.equal(JSON.parse(f.calls[0].body).title,'Untitled entry');assert.equal(f.saver.dirty,false);assert.equal(f.store.list().length,0);f.saver.dispose();
});
test('opening a blank editor makes no entry and disposing cancels pending work',async()=>{
  const f=fixture();await f.saver.flush();assert.equal(f.calls.length,0);
  f.saver.update(written);f.saver.dispose();assert.equal(f.clock.count,0);await f.saver.flush();assert.equal(f.calls.length,0);assert.equal(f.store.list().length,1);
});
test('typing during a save is serialized behind the first response',async()=>{
  const requests=[];const waiting=[];
  const f=fixture({request:(url,options)=>new Promise(resolve=>{requests.push({url,...options});waiting.push(resolve);})});
  f.saver.update(written);const done=f.saver.flush();
  f.saver.update({...written,content:'The next thought.'});assert.equal(requests.length,1);
  waiting[0](result(JSON.parse(requests[0].body)));await Promise.resolve();await Promise.resolve();
  assert.equal(requests.length,2);assert.equal(requests[1].method,'PUT');assert.equal(JSON.parse(requests[1].body).content,'The next thought.');
  waiting[1](result(JSON.parse(requests[1].body),'2026-09-10T00:00:00.002Z'));await done;assert.equal(f.saver.dirty,false);assert.equal(f.store.list().length,0);f.saver.dispose();
});
test('lost response survives a page reload and retries the identical mutation before newer writing',async()=>{
  const store=createDraftStore(storage());let committed;const first=fixture({store,request:async(url,options)=>{committed=JSON.parse(options.body);throw new Error('Response lost');}});
  first.saver.update(written);await assert.rejects(first.saver.flush());first.saver.update({...written,content:'Newer unsent writing'});first.saver.dispose();
  const recovered=store.list()[0];assert.ok(recovered.pending);assert.equal(recovered.latest.content,'Newer unsent writing');
  const replay=[];const second=fixture({store,restored:recovered,request:async(url,options)=>{const payload=JSON.parse(options.body);replay.push({method:options.method,payload});return result(payload);}});
  second.saver.resume();await second.saver.flush();assert.deepEqual(replay[0].payload,committed);assert.equal(replay[1].method,'PUT');assert.equal(replay[1].payload.content,'Newer unsent writing');assert.equal(store.list().length,0);second.saver.dispose();
});
test('version conflicts stop retries and preserve the recovery draft',async()=>{
  const f=fixture({request:async()=>{throw Object.assign(new Error('Changed elsewhere'),{status:409});}});
  f.saver.update(written);await assert.rejects(f.saver.flush());assert.equal(f.clock.count,0);assert.equal(f.states.at(-1).status,'conflict');assert.equal(f.saver.recoverable,true);assert.equal(f.store.list()[0].latest.content,written.content);f.saver.dispose();
});
test('a corrected validation error can be saved instead of retrying an invalid snapshot forever',async()=>{
  let count=0;const f=fixture({request:async(url,options)=>{count++;const p=JSON.parse(options.body);if(p.date==='')throw Object.assign(new Error('Choose a date'),{status:400});return result(p);}});
  f.saver.update({...written,date:''});await assert.rejects(f.saver.flush());assert.equal(f.clock.count,0);
  f.saver.update(written);await f.saver.flush();assert.equal(count,2);assert.equal(f.saver.dirty,false);f.saver.dispose();
});
test('storage failure does not claim a recovery copy or prevent a successful server save',async()=>{
  const f=fixture({store:{put(){throw new Error('Quota');},remove(){},list(){return[];}}});f.saver.update(written);assert.equal(f.saver.recoverable,false);await f.saver.flush();assert.equal(f.saver.dirty,false);f.saver.dispose();
});
test('independent draft keys preserve writing from different tabs; malformed data is ignored',()=>{
  const local=storage(),store=createDraftStore(local);local.setItem('charlie-journal:draft:bad','not json');
  store.put('a',{version:1,targetId:'a',latest:written});store.put('b',{version:1,targetId:'b',latest:{...written,content:'Another tab'}});assert.equal(store.list().length,2);store.remove('a');assert.equal(store.list()[0].latest.content,'Another tab');
});
test('on this day includes only matching dates from earlier years, with exact leap-day matching',()=>{
  const entries=['2025-09-10','2024-09-10','2026-09-10','2027-09-10','2025-09-09'].map(date=>({date}));
  assert.deepEqual(onThisDay(entries,'2026-09-10').map(e=>e.date),['2025-09-10','2024-09-10']);
  assert.deepEqual(onThisDay([{date:'2024-02-29'},{date:'2023-02-28'}],'2028-02-29'),[{date:'2024-02-29'}]);
  assert.equal(onThisDay([{date:'2024-02-29'}],'2027-02-28').length,0);
});
test('outline preserves the section ordering and distinguishes destination and chapter headings',()=>{
  assert.deepEqual(sections.map(s=>s.name),['Me','Family','Friends','Relationships','Dogs','Mental Health & Growth','Home','Career','Fitness','Motorcycles','Travel','Music','Food & Cooking','Hobbies','Experiences','Life Timeline','Journal','Memories','Future','Things I Believe']);
  assert.deepEqual(sections.find(s=>s.id==='travel').subsections,['Spain','Budapest','Seattle','California Trips']);
  assert.deepEqual(sections.find(s=>s.id==='timeline').subsections,sections.find(s=>s.id==='timeline').prompts);
  assert.ok(sections.every(s=>s.prompts.length>0&&s.subsections.every(topic=>s.prompts.includes(topic))));
});
