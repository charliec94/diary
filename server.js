import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sections, chapters } from './public/sections.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const allowedSections = new Set(sections.map(s => s.id));
const MAX_FILE = 25 * 1024 * 1024;
const fail = (status, message) => Object.assign(new Error(message), { status });
function text(value, max, label, required = false) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw fail(400, `Check ${label}.`);
  return value.trim();
}
function validateEntry(body) {
  const title = text(body.title, 200, 'the title', true);
  const content = text(body.content, 200000, 'the entry');
  if (!allowedSections.has(body.section)) throw fail(400, 'Choose a section.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(body.date) || Number.isNaN(Date.parse(body.date)) || new Date(body.date).toISOString().slice(0,10) !== body.date) throw fail(400, 'Choose a valid date.');
  if (body.chapter && !chapters.includes(body.chapter)) throw fail(400, 'Choose a life chapter.');
  if (body.mood && !['Great', 'Good', 'Okay', 'Low', 'Difficult'].includes(body.mood)) throw fail(400, 'Choose a mood.');
  return { title, content, section: body.section, date: body.date, chapter: body.chapter || '', mood: body.mood || '', tags: text(body.tags || '', 300, 'the tags'), favorite: body.favorite === true ? 1 : 0 };
}
async function readBody(req, max) {
  if (Number(req.headers['content-length']) > max) throw fail(413, 'This file is too large. Maximum: 25 MB.');
  const parts = []; let length = 0;
  for await (const part of req) { length += part.length; if (length > max) throw fail(413, 'Request is too large.'); parts.push(part); }
  return Buffer.concat(parts);
}
async function jsonBody(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw fail(415, 'Expected JSON.');
  try { const result = JSON.parse((await readBody(req, 1024 * 1024)).toString()); if (!result || typeof result !== 'object' || Array.isArray(result)) throw fail(400, 'Invalid request.'); return result; }
  catch (error) { if (error.status) throw error; throw fail(400, 'Invalid JSON.'); }
}
function mediaType(data, name) {
  if (data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
  if (data[0] === 255 && data[1] === 216 && data[2] === 255) return 'image/jpeg';
  if (['GIF87a','GIF89a'].includes(data.subarray(0,6).toString())) return 'image/gif';
  if (data.subarray(0,4).toString() === 'RIFF' && data.subarray(8,12).toString() === 'WEBP') return 'image/webp';
  if (data.subarray(0,4).toString() === 'RIFF' && data.subarray(8,12).toString() === 'WAVE') return 'audio/wav';
  if (data.subarray(0,4).toString() === 'OggS') return 'audio/ogg';
  if (data.subarray(0,3).toString() === 'ID3' || (data[0] === 255 && (data[1] & 224) === 224)) return 'audio/mpeg';
  if (data.subarray(4,8).toString() === 'ftyp') return /\.m4a$/i.test(name) ? 'audio/mp4' : 'video/mp4';
  if (data.subarray(0,4).equals(Buffer.from([26,69,223,163]))) return /\.weba$/i.test(name) ? 'audio/webm' : 'video/webm';
  if (data.subarray(0,5).toString() === '%PDF-') return 'application/pdf';
  if (/\.(txt|md)$/i.test(name) && !data.includes(0)) return 'text/plain';
  throw fail(415, 'Use JPG, PNG, GIF, WebP, MP3, M4A, WAV, OGG, MP4, WebM, PDF, TXT, or Markdown.');
}

export function createJournal({ dataDir = process.env.DATA_DIR || path.join(root, 'data'), appOrigin = process.env.APP_ORIGIN || '' } = {}) {
  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'journal.sqlite'), { timeout: 5000 });
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS entries (id TEXT PRIMARY KEY, title TEXT NOT NULL, content TEXT NOT NULL, section TEXT NOT NULL, date TEXT NOT NULL, chapter TEXT NOT NULL, mood TEXT NOT NULL, tags TEXT NOT NULL, favorite INTEGER NOT NULL DEFAULT 0, created TEXT NOT NULL, updated TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS attachments (id TEXT PRIMARY KEY, entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE, name TEXT NOT NULL, type TEXT NOT NULL, size INTEGER NOT NULL, data BLOB NOT NULL);
    CREATE INDEX IF NOT EXISTS attachments_entry ON attachments(entry_id);
    CREATE INDEX IF NOT EXISTS entries_date ON entries(date);`);
  // Legacy authentication tables are left untouched for non-destructive upgrades.
  // Access is now controlled by the network; no password or session is required.
  const staticFiles = new Map([['/', ['index.html', 'text/html']], ['/app.js', ['app.js','text/javascript']], ['/style.css',['style.css','text/css']], ['/sections.js',['sections.js','text/javascript']], ['/favicon.svg',['favicon.svg','image/svg+xml']]].map(([url,[file,type]]) => [url,{ data: readFileSync(path.join(root,'public',file)), type }]));
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const send = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
    try {
      const url = new URL(req.url, 'http://localhost');
      const route = url.pathname;
      if (['GET','HEAD'].includes(req.method) && route === '/health') { db.prepare('SELECT 1').get(); return send(200, { status: 'ok' }); }
      if (req.method === 'GET' && staticFiles.has(route)) { const file = staticFiles.get(route); res.writeHead(200, { 'Content-Type': file.type + '; charset=utf-8' }); return res.end(file.data); }
      if (!route.startsWith('/api/')) throw fail(404, 'Not found.');
      if (!['GET','HEAD'].includes(req.method)) {
        // Every mutation requires a custom header; browsers cannot send it cross-origin without a preflight.
        if (req.headers['x-journal-request'] !== '1') throw fail(403, 'Request not allowed.');
        if (req.headers['sec-fetch-site'] === 'cross-site') throw fail(403, 'Request not allowed.');
        if (req.headers.origin) {
          let origin; try { origin = new URL(req.headers.origin); } catch { throw fail(403, 'Invalid origin.'); }
          if (appOrigin ? origin.origin !== new URL(appOrigin).origin : origin.host !== req.headers.host) throw fail(403, 'Request not allowed.');
        }
      }
      if (route === '/api/status' && req.method === 'GET') return send(200, { authentication: false });
      if (route === '/api/entries' && req.method === 'GET') {
        const rows = db.prepare('SELECT entries.*, (SELECT COUNT(*) FROM attachments WHERE entry_id=entries.id) AS attachment_count, (SELECT id FROM attachments WHERE entry_id=entries.id AND type LIKE \'image/%\' LIMIT 1) AS cover FROM entries ORDER BY date DESC, created DESC').all();
        return send(200, rows);
      }
      if (route === '/api/export' && req.method === 'GET') {
        res.setHeader('Content-Disposition', 'attachment; filename="charlie-journal.json"');
        return send(200, { version: 1, exported: new Date().toISOString(), entries: db.prepare('SELECT * FROM entries ORDER BY date').all(), attachments: db.prepare('SELECT id,entry_id,name,type,size FROM attachments').all(), note: 'Attachment files are not included. Download them individually or back up the entire data directory with the container stopped.' });
      }
      if (route === '/api/entries' && req.method === 'POST') {
        const entry = validateEntry(await jsonBody(req));
        const id = randomUUID(); const now = new Date().toISOString();
        db.prepare('INSERT INTO entries (id,title,content,section,date,chapter,mood,tags,favorite,created,updated) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(id, entry.title, entry.content, entry.section, entry.date, entry.chapter, entry.mood, entry.tags, entry.favorite, now, now);
        return send(201, { id, ...entry, created: now, updated: now });
      }
      const match = /^\/api\/entries\/([a-f0-9-]{36})(\/attachments)?$/.exec(route);
      if (match) {
        const entry = db.prepare('SELECT * FROM entries WHERE id=?').get(match[1]);
        if (!entry) throw fail(404, 'Entry not found.');
        if (match[2]) {
          if (req.method === 'GET') return send(200, db.prepare('SELECT id,name,type,size FROM attachments WHERE entry_id=?').all(entry.id));
          if (req.method === 'POST') {
            if (db.prepare('SELECT COUNT(*) AS count FROM attachments WHERE entry_id=?').get(entry.id).count >= 20) throw fail(400, 'Each entry can hold up to 20 attachments.');
            let name; try { name = decodeURIComponent(req.headers['x-file-name'] || ''); } catch { throw fail(400, 'Invalid filename.'); }
            name = text(name, 240, 'the filename', true).replace(/[\x00-\x1f\x7f/\\]/g, '_');
            const data = await readBody(req, MAX_FILE);
            if (!data.length) throw fail(400, 'The file is empty.');
            const type = mediaType(data, name); const id = randomUUID();
            // Recheck after receiving the upload: another request may have used the final slot.
            if (db.prepare('SELECT COUNT(*) AS count FROM attachments WHERE entry_id=?').get(entry.id).count >= 20) throw fail(400, 'Each entry can hold up to 20 attachments.');
            if (!db.prepare('SELECT id FROM entries WHERE id=?').get(entry.id)) throw fail(404, 'Entry was deleted during upload.');
            db.prepare('INSERT INTO attachments VALUES (?,?,?,?,?,?)').run(id, entry.id, name, type, data.length, data);
            return send(201, { id, name, type, size: data.length });
          }
        } else {
          if (req.method === 'GET') return send(200, entry);
          if (req.method === 'PUT') {
            const body = await jsonBody(req); const next = validateEntry(body);
            const updated = new Date().toISOString();
            const result = db.prepare('UPDATE entries SET title=?,content=?,section=?,date=?,chapter=?,mood=?,tags=?,favorite=?,updated=? WHERE id=? AND updated=?').run(next.title,next.content,next.section,next.date,next.chapter,next.mood,next.tags,next.favorite,updated,entry.id,body.updated || '');
            if (!result.changes) throw fail(409, 'This entry changed in another tab. Copy your changes before reopening it.');
            return send(200, { ...entry, ...next, updated });
          }
          if (req.method === 'DELETE') { db.prepare('DELETE FROM entries WHERE id=?').run(entry.id); return send(200, { ok: true }); }
        }
      }
      const attachment = /^\/api\/attachments\/([a-f0-9-]{36})$/.exec(route);
      if (attachment) {
        if (req.method === 'DELETE') { const result = db.prepare('DELETE FROM attachments WHERE id=?').run(attachment[1]); if (!result.changes) throw fail(404, 'Attachment not found.'); return send(200, { ok: true }); }
        if (req.method === 'GET') {
          const file = db.prepare('SELECT * FROM attachments WHERE id=?').get(attachment[1]);
          if (!file) throw fail(404, 'Attachment not found.');
          const inline = /^(image|audio|video)\//.test(file.type) && !url.searchParams.has('download');
          res.setHeader('Content-Type', file.type);
          res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.name).replace(/'/g,'%27')}`);
          res.setHeader('Accept-Ranges', 'bytes');
          if (req.headers.range) {
            const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
            let start = range?.[1] ? Number(range[1]) : Math.max(0, file.size - Number(range?.[2]));
            let end = range?.[1] && range?.[2] ? Math.min(Number(range[2]), file.size - 1) : file.size - 1;
            if (!range || (!range[1] && !range[2]) || start > end || start >= file.size || !Number.isSafeInteger(start)) { res.setHeader('Content-Range', `bytes */${file.size}`); return res.writeHead(416).end(); }
            res.setHeader('Content-Range', `bytes ${start}-${end}/${file.size}`);
            res.setHeader('Content-Length', end - start + 1);
            return res.writeHead(206).end(Buffer.from(file.data).subarray(start,end+1));
          }
          res.setHeader('Content-Length', file.size); return res.end(Buffer.from(file.data));
        }
      }
      throw fail(404, 'Not found.');
    } catch (error) {
      if (!error.status) console.error('Request failed:', error.code || error.name);
      if (!res.headersSent) send(error.status || 500, { error: error.status ? error.message : 'Could not complete the request. Please try again.' });
      else res.end();
    }
  });
  server.requestTimeout = 120000;
  server.headersTimeout = 15000;
  server.on('close', () => db.close());
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createJournal();
  const port = Number(process.env.PORT || 3000);
  server.listen(port, process.env.HOST || '0.0.0.0', () => console.log(`Charlie — Life Journal: http://localhost:${port}`));
  for (const signal of ['SIGTERM','SIGINT']) process.on(signal, () => { server.close(() => process.exit(0)); setTimeout(() => process.exit(1), 10000).unref(); });
}
