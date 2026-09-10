import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createJournal } from '../server.js';
import { sections } from '../public/sections.js';

test('password-free journal, writing, memories, and persistence', async t => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'diary-test-'));
  let server, base, entry, attachment;
  async function start() { server = createJournal({ dataDir }); server.listen(0, '127.0.0.1'); await once(server, 'listening'); base = `http://127.0.0.1:${server.address().port}`; }
  async function stop() { const closed = once(server, 'close'); server.close(); server.closeAllConnections(); await closed; }
  t.after(async () => { if (server.listening) await stop(); rmSync(dataDir, { recursive: true, force: true }); });
  // Emulate a previous installation without touching any real journal data.
  const legacy = new DatabaseSync(path.join(dataDir, 'journal.sqlite'));
  legacy.exec("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE sessions (token TEXT PRIMARY KEY, expires INTEGER NOT NULL);");
  legacy.prepare('INSERT INTO settings VALUES (?,?)').run('password','legacy-test-value');
  legacy.close();
  await start();
  const request = (url, method = 'GET', body, headers = {}) => fetch(base + url, { method, headers: { 'X-Journal-Request':'1', ...(body !== undefined && !Buffer.isBuffer(body) ? {'Content-Type':'application/json'} : {}), ...headers }, body: body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body) });
  const fixture = { title: 'A test memory', content: 'A quiet walk with a friend.\nA second line.', section:'friends', date:'2026-09-09', chapter:'2026 — Rebuilding', mood:'Good', tags:'friend, walk', favorite:true };

  await t.test('health works for GET and Docker HEAD checks', async () => {
    assert.equal((await request('/health')).status,200);assert.equal((await request('/health','HEAD')).status,200);
    const page = await request('/'); assert.equal(page.status,200);assert.match(page.headers.get('content-security-policy'),/frame-ancestors 'none'/);
    assert.equal(sections.length,20);
  });
  await t.test('existing journal opens without credentials or a setup step', async () => {
    for (const url of ['/api/entries','/api/export']) { const response=await request(url); assert.equal(response.status,200); assert.equal(response.headers.get('set-cookie'),null); }
    assert.deepEqual(await (await request('/api/status')).json(),{authentication:false});
    for (const url of ['/api/setup','/api/login','/api/logout']) assert.equal((await request(url,'POST',{})).status,404);
    const legacy = new DatabaseSync(path.join(dataDir, 'journal.sqlite'));
    assert.equal(legacy.prepare("SELECT value FROM settings WHERE key='password'").get().value,'legacy-test-value');
    legacy.close();
  });
  await t.test('cross-origin mutations remain blocked without password protection', async () => {
    assert.equal((await request('/api/entries','POST',fixture,{Origin:'https://untrusted.example'})).status,403);
    assert.equal((await fetch(base+'/api/entries',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(fixture)})).status,403);
  });
  await t.test('create and list an entry with literal content', async () => {
    const response=await request('/api/entries','POST',fixture);assert.equal(response.status,201);entry=await response.json();
    const rows=await (await request('/api/entries')).json();assert.equal(rows.length,1);assert.equal(rows[0].content,fixture.content);assert.equal(rows[0].favorite,1);
  });
  await t.test('invalid dates, sections and moods cannot corrupt records', async () => {
    for(const change of [{date:'2026-02-30'},{section:'unknown'},{mood:'unknown'},{chapter:'unknown'},{title:''}]) assert.equal((await request('/api/entries','POST',{...fixture,...change})).status,400);
    assert.equal((await (await request('/api/entries')).json()).length,1);
  });
  await t.test('edits persist and stale versions are rejected', async () => {
    const original=entry.updated;const updated=await request(`/api/entries/${entry.id}`,'PUT',{...fixture,content:'An updated memory.',updated:original});assert.equal(updated.status,200);entry=await updated.json();
    const stale=await request(`/api/entries/${entry.id}`,'PUT',{...fixture,updated:'stale-version'});assert.equal(stale.status,409);
    assert.equal((await (await request(`/api/entries/${entry.id}`)).json()).content,'An updated memory.');
  });
  await t.test('autosave retries are idempotent and outline topics persist', async () => {
    const id=randomUUID();const create={...fixture,id,topic:'How we met',mutation_id:randomUUID()};
    const created=await request('/api/entries','POST',create);assert.equal(created.status,201);let row=await created.json();
    const replay=await request('/api/entries','POST',create);assert.equal(replay.status,200);assert.equal((await replay.json()).updated,row.updated);
    assert.equal((await (await request('/api/entries')).json()).filter(e=>e.id===id).length,1);
    assert.equal((await request('/api/entries','POST',{...create,content:'A conflicting create'})).status,409);
    const edit={...create,content:'A newer autosave',updated:row.updated,mutation_id:randomUUID()};
    const response=await request(`/api/entries/${id}`,'PUT',edit);assert.equal(response.status,200);row=await response.json();assert.equal(row.topic,'How we met');
    const again=await request(`/api/entries/${id}`,'PUT',edit);assert.equal(again.status,200);assert.equal((await again.json()).updated,row.updated);
    assert.equal((await request(`/api/entries/${id}`,'PUT',{...edit,updated:row.updated,topic:'Spain',mutation_id:randomUUID()})).status,400);
    assert.equal((await request(`/api/entries/${id}`,'PUT',{...edit,content:'Stale overwrite',mutation_id:randomUUID()})).status,409);
    await request(`/api/entries/${id}`,'DELETE');
  });
  await t.test('uploads are typed by bytes; unsupported active content is blocked', async () => {
    const svg=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    assert.equal((await request(`/api/entries/${entry.id}/attachments`,'POST',svg,{'X-File-Name':'fake.png','Content-Type':'image/png'})).status,415);
    const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+afo8AAAAASUVORK5CYII=','base64');
    const uploaded=await request(`/api/entries/${entry.id}/attachments`,'POST',png,{'X-File-Name':'memory.png','Content-Type':'application/octet-stream'});assert.equal(uploaded.status,201);attachment=await uploaded.json();assert.equal(attachment.type,'image/png');
    const read=await request(`/api/attachments/${attachment.id}`);assert.deepEqual(Buffer.from(await read.arrayBuffer()),png);assert.match(read.headers.get('content-disposition'),/^inline/);
    const range=await request(`/api/attachments/${attachment.id}`,'GET',undefined,{Range:'bytes=0-7'});assert.equal(range.status,206);assert.equal((await range.arrayBuffer()).byteLength,8);
    assert.equal((await request(`/api/attachments/${attachment.id}`,'GET',undefined,{Range:'bytes=999999-'})).status,416);
    const row=(await (await request('/api/entries')).json())[0];assert.equal(row.attachment_count,1);assert.equal(row.cover,attachment.id);
  });
  await t.test('download and text exports do not expose credentials', async () => {
    const download=await request(`/api/attachments/${attachment.id}?download=1`);assert.match(download.headers.get('content-disposition'),/^attachment/);
    const exported=await (await request('/api/export')).json();assert.equal(exported.entries.length,1);assert.equal(exported.attachments.length,1);assert.equal(exported.attachments[0].data,undefined);assert.equal(exported.settings,undefined);assert.equal(exported.sessions,undefined);
  });
  await t.test('malformed JSON and oversized uploads fail cleanly', async () => {
    const malformed=await fetch(base+'/api/entries',{method:'POST',headers:{'X-Journal-Request':'1','Content-Type':'application/json'},body:'{broken'});assert.equal(malformed.status,400);
    assert.equal((await request(`/api/entries/${entry.id}/attachments`,'POST',Buffer.alloc(25*1024*1024+1),{'X-File-Name':'large.png'})).status,413);
  });
  await t.test('restart keeps writing and attachments accessible without sign-in', async () => {
    await stop();await start();
    const rows=await (await request('/api/entries')).json();assert.equal(rows[0].id,entry.id);assert.equal(rows[0].content,'An updated memory.');assert.equal(rows[0].attachment_count,1);
    assert.equal((await request(`/api/attachments/${attachment.id}`)).status,200);
  });
  await t.test('deleting entries removes their attachments', async () => {
    assert.equal((await request(`/api/entries/${entry.id}`,'DELETE')).status,200);
    assert.equal((await request(`/api/attachments/${attachment.id}`)).status,404);
    assert.equal((await (await request('/api/entries')).json()).length,0);
  });

});

test('upgrading the original schema keeps existing writing and adds empty topics',async t=>{
  const dataDir=mkdtempSync(path.join(tmpdir(),'diary-upgrade-'));
  const legacy=new DatabaseSync(path.join(dataDir,'journal.sqlite'));
  legacy.exec('CREATE TABLE entries (id TEXT PRIMARY KEY, title TEXT NOT NULL, content TEXT NOT NULL, section TEXT NOT NULL, date TEXT NOT NULL, chapter TEXT NOT NULL, mood TEXT NOT NULL, tags TEXT NOT NULL, favorite INTEGER NOT NULL, created TEXT NOT NULL, updated TEXT NOT NULL)');
  const id=randomUUID();legacy.prepare('INSERT INTO entries VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(id,'Existing writing','Keep this text','me','2025-09-10','','','',0,'2025-09-10T00:00:00.000Z','2025-09-10T00:00:00.000Z');legacy.close();
  const server=createJournal({dataDir});server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{const closed=once(server,'close');server.close();server.closeAllConnections();await closed;rmSync(dataDir,{recursive:true,force:true});});
  const response=await fetch(`http://127.0.0.1:${server.address().port}/api/entries/${id}`);assert.equal(response.status,200);const row=await response.json();assert.equal(row.content,'Keep this text');assert.equal(row.topic,'');assert.equal(row.updated,'2025-09-10T00:00:00.000Z');
});
