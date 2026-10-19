import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readingHTML,monthDays,moveMonth,photoType} from '../public/reading.js';

test('reading mode formats editor-supported Markdown and keeps literal code intact',()=>{
  const html=readingHTML('# A day\n\n**Good** and *quiet*.\nAnother line\n\n- Walk\n- Coffee\n\n> Remember this\n\n```\n<script>**literal**</script>\n```');
  assert.match(html,/<h2>A day<\/h2>/);assert.match(html,/<strong>Good<\/strong> and <em>quiet<\/em>/);
  assert.match(html,/<br>Another line/);assert.match(html,/<ul><li>Walk<\/li><li>Coffee<\/li><\/ul>/);
  assert.match(html,/<blockquote>Remember this<\/blockquote>/);assert.match(html,/&lt;script&gt;\*\*literal\*\*&lt;\/script&gt;/);
  assert.equal(readingHTML('`**code**`'),'<p><code>**code**</code></p>');
});
test('reading does not execute HTML or load external Markdown images',()=>{
  const html=readingHTML('<img src=x onerror="alert(1)">\n![private](https://example.com/tracker)\n[jump](javascript:alert(1))');
  assert.doesNotMatch(html,/<img|<script|<a\s/i);assert.match(html,/&lt;img/);
  assert.equal(readingHTML(''), '');
  assert.equal(readingHTML('```\nunfinished'),'<pre><code>unfinished</code></pre>');
});
test('calendar handles leap days, weekday placement, and year boundaries',()=>{
  assert.equal(monthDays('2024-02').days.length,29);assert.equal(monthDays('2025-02').days.length,28);
  assert.equal(monthDays('2026-10').offset,4);assert.equal(monthDays('2026-10').days.at(-1),'2026-10-31');
  assert.equal(moveMonth('2026-12',1),'2027-01');assert.equal(moveMonth('2026-01',-1),'2025-12');
  assert.equal(moveMonth('0001-01',-1),'0001-01');assert.equal(moveMonth('9999-12',1),'9999-12');
  assert.throws(()=>monthDays('2026-13'));assert.throws(()=>monthDays('2026-1'));
});
test('quick photo format detection uses bytes instead of filename or supplied type',()=>{
  assert.equal(photoType(Uint8Array.from([137,80,78,71,13,10,26,10])),'image/png');
  assert.equal(photoType(Uint8Array.from([255,216,255,0])),'image/jpeg');
  assert.equal(photoType(new TextEncoder().encode('GIF89a')),'image/gif');
  assert.equal(photoType(new TextEncoder().encode('RIFF0000WEBP')),'image/webp');
  assert.equal(photoType(new TextEncoder().encode('<svg onload="alert(1)">')),'');
  assert.equal(photoType(new Uint8Array()),'');
});
