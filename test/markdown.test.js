import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { exportMarkdown, parseMarkdown, formatSelection } from '../public/markdown.js';
import { sections } from '../public/sections.js';
import { createJournal } from '../server.js';

const fixture={title:'A synthetic trip',content:'A quiet afternoon.\n\n## A heading\n```js\nconst a = 1;\n```\n<!-- charlie-entry:literal -->\n<script>text only</script>',section:'travel',topic:'Spain',date:'2020-02-29',mood:'Good',chapter:'20s',tags:'walk, food',favorite:true};
test('Markdown round trip preserves writing and all metadata, including fence-like content',()=>{
  const document=exportMarkdown([fixture]);
  assert.deepEqual(parseMarkdown(document,'2026-10-01').entries,[fixture]);
  let position=-1;
  for(const section of sections){const next=document.indexOf(`## ${section.name}\n`);assert.ok(next>position);position=next;}
  assert.equal(parseMarkdown(exportMarkdown([]),'2026-10-01').entries.length,0);
});
test('outline bullets are structure, with emoji and typography normalized',()=>{
  const outline=sections.map(s=>`## 📝 ${s.name}\n`+s.prompts.map(p=>`- ${p.replaceAll('’',"'")}`).join('\n')).join('\n\n');
  assert.equal(parseMarkdown(outline,'2026-10-01').entries.length,0);
  const parsed=parseMarkdown("# My journal\n## 👤 Me\n- Who I am\nA little writing.\n- Things I'm working on\nMore writing.\n## Travel\n### Spain\nA trip.\n",'2026-10-01');
  assert.deepEqual(parsed.entries.map(e=>[e.section,e.topic,e.content]),[['me','Who I am','A little writing.'],['me','Things I’m working on','More writing.'],['travel','Spain','A trip.']]);
});
test('unknown headings and fenced outline lookalikes retain their writing',()=>{
  const parsed=parseMarkdown('## Friends\n### Unexpected story\nSome writing.\n```md\n## Travel\n- Spain\n```','2026-10-01');
  assert.equal(parsed.entries.length,1);assert.equal(parsed.entries[0].section,'friends');assert.equal(parsed.entries[0].topic,'');
  assert.match(parsed.entries[0].content,/## Travel/);assert.ok(parsed.warnings.length);
  assert.equal(parseMarkdown('## Me\nFirst paragraph.\n\n---\n\nSecond paragraph.','2026-10-01').entries[0].content,'First paragraph.\n\n---\n\nSecond paragraph.');
});
test('damaged exports fail instead of silently losing an entry',()=>{
  const document=exportMarkdown([fixture]);
  assert.throws(()=>parseMarkdown(document.replace('````markdown','```bad'),'2026-10-01'));
  assert.throws(()=>parseMarkdown('x'.repeat(2_000_001),'2026-10-01'));
});
test('formatting wraps selected writing and separates block styles',()=>{
  assert.equal(formatSelection('hello world',6,11,'bold').replacement,'**world**');
  assert.equal(formatSelection('hello world',6,11,'heading').replacement,'\n### world');
  assert.equal(formatSelection('one\ntwo',0,7,'list').replacement,'- one\n- two');
});
test('imports validate atomically, deduplicate, survive replay and export over HTTP',async t=>{
  const dataDir=mkdtempSync(path.join(tmpdir(),'journal-import-'));
  const server=createJournal({dataDir});server.listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}`;
  t.after(async()=>{const closed=once(server,'close');server.close();server.closeAllConnections();await closed;rmSync(dataDir,{recursive:true,force:true});});
  const post=body=>fetch(base+'/api/import',{method:'POST',headers:{'Content-Type':'application/json','X-Journal-Request':'1'},body:JSON.stringify(body)});
  const list=async()=>await (await fetch(base+'/api/entries')).json();
  assert.equal((await post({id:randomUUID(),entries:[fixture,{...fixture,date:'2026-02-30'}]})).status,400);
  assert.equal((await list()).length,0);
  const batch={id:randomUUID(),entries:[fixture,fixture]};
  assert.deepEqual(await (await post(batch)).json(),{added:1,skipped:1});
  const original=(await list())[0];
  assert.deepEqual(await (await post(batch)).json(),{added:1,skipped:1});
  assert.equal((await list()).length,1);
  assert.deepEqual(await (await post({...batch,id:randomUUID()})).json(),{added:0,skipped:2});
  assert.deepEqual((await list())[0],original);
  assert.equal((await post({...batch,entries:[{...fixture,content:'Changed'}]})).status,409);
  const response=await fetch(base+'/api/export/markdown');assert.equal(response.status,200);
  assert.match(response.headers.get('content-disposition'),/\.md/);
  assert.deepEqual(parseMarkdown(await response.text(),'2026-10-01').entries,[fixture]);
  assert.equal((await fetch(base+'/markdown.js')).status,200);
  assert.equal((await fetch(base+'/api/import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(batch)})).status,403);
});
