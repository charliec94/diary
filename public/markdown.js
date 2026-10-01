import { sections } from './sections.js';

const normalize = value => value.normalize('NFKC').toLowerCase().replace(/[’‘]/g, "'").replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const heading = value => value.replace(/[\r\n]/g, ' ');
const defaults = date => ({ section:'journal', topic:'', title:'Imported writing', date, chapter:'', mood:'', tags:'', favorite:false });

// Longer fences keep arbitrary Markdown (including headings and code blocks) intact.
export function exportMarkdown(entries) {
  const out = ['# Charlie — Life Journal', '', '<!-- charlie-journal:v1 -->', '', 'Writing export. Attachments are not included.', ''];
  for (const section of sections) {
    out.push(`## ${section.name}`, '');
    for (const topic of ['', ...section.prompts]) {
      out.push(`### ${topic || 'General entries'}`, '');
      for (const entry of entries.filter(e => e.section === section.id && (e.topic || '') === topic)) {
        const meta = Object.fromEntries(['title','section','topic','date','chapter','mood','tags'].map(key => [key, entry[key] || '']));
        meta.favorite = Boolean(entry.favorite);
        const fence = '`'.repeat(Math.max(3, ...[...entry.content.matchAll(/`+/g)].map(m => m[0].length + 1)));
        out.push(`#### ${heading(entry.title)}`, '', `<!-- charlie-entry:${encodeURIComponent(JSON.stringify(meta))} -->`, `${fence}markdown`, entry.content, fence, '');
      }
    }
  }
  return out.join('\n');
}

export function parseMarkdown(source, date) {
  if (typeof source !== 'string' || source.length > 2_000_000) throw new Error('Choose a Markdown file under 2 MB.');
  const lines = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
  const entries = [], warnings = [];
  if (lines.includes('<!-- charlie-journal:v1 -->')) {
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].startsWith('<!-- charlie-entry:')) continue;
      const marker = /^<!-- charlie-entry:(.+) -->$/.exec(lines[i]);
      if (!marker) throw new Error('An exported entry has damaged metadata. No writing was imported.');
      let meta;
      try { meta = JSON.parse(decodeURIComponent(marker[1])); } catch { throw new Error('An exported entry has damaged metadata.'); }
      const fence = /^(`{3,})markdown$/.exec(lines[++i]);
      if (!fence) throw new Error('An exported entry is missing its writing block.');
      const content = [];
      while (++i < lines.length && lines[i] !== fence[1]) content.push(lines[i]);
      if (i === lines.length) throw new Error('An exported entry has an unfinished writing block.');
      entries.push({ ...defaults(date), ...meta, content:content.join('\n') });
    }
  } else {
    let current = defaults(date), content = [], fence = null;
    const flush = () => {
      const writing = content.join('\n').trim();
      if (writing) entries.push({ ...current, content:writing });
      content = [];
    };
    for (const line of lines) {
      const code = /^\s*(`{3,}|~{3,})/.exec(line);
      if (fence) {
        content.push(line);
        if (new RegExp(`^\\s*${fence[0]}{${fence.length},}\\s*$`).test(line)) fence = null;
        continue;
      }
      if (code) { fence=code[1]; content.push(line); continue; }
      const h = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
      const bullet = /^\s*[-*+]\s+(?:\[[ xX]\]\s*)?(.+)$/.exec(line);
      const label = (h?.[2] || bullet?.[1] || '').replace(/\*\*/g,'');
      const section = h && sections.find(s => normalize(s.name) === normalize(label));
      if (section) { flush(); current={...defaults(date),section:section.id,title:section.name}; continue; }
      const topic = sections.find(s => s.id === current.section).prompts.find(p => normalize(p) === normalize(label));
      if (topic) { flush(); current={...current,topic,title:topic}; continue; }
      if (h && h[1].length <= 3) {
        flush(); current={...current, topic:'', title:label.slice(0,200)};
        if (h[1].length > 1) warnings.push(`“${label}” will be kept as a general entry in ${sections.find(s=>s.id===current.section).name}.`);
        continue;
      }
      // Blank outline separators are structural, not personal writing.
      if (/^\s*(?:---+|\*\*\*+)\s*$/.test(line) && !content.some(part => part.trim())) continue;
      content.push(line);
    }
    flush();
    if (entries.length) warnings.unshift('Entries without exported date information use the date selected below.');
  }
  if (entries.length > 500) throw new Error('Import up to 500 entries at a time.');
  return { entries, warnings:[...new Set(warnings)] };
}

export function formatSelection(value, start, end, style) {
  const selected=value.slice(start,end);
  const replacements={bold:`**${selected || 'bold text'}**`,italic:`*${selected || 'italic text'}*`,heading:`### ${selected || 'Heading'}`,list:(selected || 'List item').split('\n').map(line=>`- ${line}`).join('\n'),quote:(selected || 'Quote').split('\n').map(line=>`> ${line}`).join('\n')};
  let replacement=replacements[style];
  if (replacement === undefined) throw new Error('Unknown formatting option.');
  if (['heading','list','quote'].includes(style) && start > 0 && value[start-1] !== '\n') replacement='\n'+replacement;
  return { replacement, start, end };
}
