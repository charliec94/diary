import { sections, chapters } from './sections.js';
const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const sectionById = id => sections.find(s => s.id === id) || sections.find(s => s.id === 'journal');
const localDate = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
const formatDate = date => new Date(`${date}T12:00:00`).toLocaleDateString(undefined,{ month:'short',day:'numeric',year:'numeric' });
let entries = [], active = 'all', query = '', moodFilter = '', chapterFilter = '', sort = 'newest', editing = null, dirty = false, busy = false, toastTimer;
async function api(url, options = {}) {
  const headers = { 'X-Journal-Request': '1', ...options.headers };
  if (options.body && typeof options.body === 'string') headers['Content-Type'] = 'application/json';
  const response = await fetch(url, { ...options, headers });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Something went wrong. Please try again.');
  }
  return data;
}
function toast(message) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').hidden = true, 5000); }
async function start() { entries = await api('/api/entries'); active = location.hash.slice(1) || 'all'; render(); }
function nav() {
  const primary = [['all','All entries','▤'],['favorites','Favorites','☆'],['life','Life timeline','⌁'],['gallery','Memory box','▧']];
  const navItem = (id,name,icon,count) => `<a class="nav-item ${active === id ? 'active' : ''}" href="#${id}" ${active === id ? 'aria-current="page"' : ''}><span class="nav-icon" aria-hidden="true">${icon}</span><span>${esc(name)}</span>${count ? `<span class="nav-count">${count}</span>` : ''}</a>`;
  $('#main-nav').innerHTML = primary.map(([id,name,icon]) => navItem(id,name,icon,id === 'all' ? entries.length : '')).join('');
  $('#section-nav').innerHTML = sections.map(s => navItem(s.id,s.name,s.icon,entries.filter(e=>e.section===s.id).length)).join('');
}
function card(entry) {
  const section = sectionById(entry.section);
  return `<button class="entry-card" data-entry="${entry.id}"><span class="entry-date">${esc(formatDate(entry.date))}</span><span class="entry-body">${active === 'gallery' && entry.cover ? `<img class="card-image" loading="lazy" src="/api/attachments/${entry.cover}" alt="">` : ''}<span class="entry-title">${esc(entry.title)}${entry.favorite ? '<span class="favorite-star" aria-label="Favorite"> · ★</span>' : ''}</span><span class="entry-excerpt">${esc(entry.content || 'A moment saved for later.')}</span><span class="card-meta">${esc(section.name)}${entry.attachment_count ? ` · ${entry.attachment_count} attachment${entry.attachment_count === 1 ? '' : 's'}` : ''}</span></span><span class="entry-arrow" aria-hidden="true">↗</span></button>`;
}
function filteredEntries() {
  const needle = query.toLocaleLowerCase();
  const rows = entries.filter(e => (active === 'all' || active === 'life' || (active === 'favorites' && e.favorite) || (active === 'gallery' && (e.attachment_count || e.section === 'memories')) || e.section === active) && (!moodFilter || e.mood === moodFilter) && (!chapterFilter || e.chapter === chapterFilter) && (!needle || [e.title,e.content,e.tags,e.chapter,sectionById(e.section).name].some(s => s.toLocaleLowerCase().includes(needle))));
  return rows.sort((a,b) => sort === 'oldest' ? a.date.localeCompare(b.date) : sort === 'updated' ? b.updated.localeCompare(a.updated) : b.date.localeCompare(a.date));
}
function renderResults() {
  const rows = filteredEntries(); $('#result-count').textContent = `${rows.length} ${rows.length === 1 ? 'entry' : 'entries'}`;
  if (!rows.length) {
    const hasFilter = query || moodFilter || chapterFilter;
    $('#results').innerHTML = `<div class="empty-state"><div class="empty-symbol" aria-hidden="true">${active==='gallery'?'▧':'▤'}</div><h2>${hasFilter ? 'No entries found' : active === 'favorites' ? 'Keep the moments you love' : active === 'gallery' ? 'A home for your keepsakes' : 'A blank page.'}</h2><p>${hasFilter ? 'Try a different search or clear your filters.' : active === 'favorites' ? 'Mark an entry as a favorite to find it here.' : active === 'gallery' ? 'Add photos, voice notes, tickets, and videos to an entry. Find those entries together here.' : 'Begin with whatever is on your mind.'}</p><button class="primary" data-action="${hasFilter ? 'clear-filters' : 'new'}">${hasFilter ? 'Clear filters' : 'Write an entry'} <span>↗</span></button></div>`;
  } else if (active === 'life') {
    const groups = new Map();
    for (const e of rows) { const group = e.date.slice(0,4); if (!groups.has(group)) groups.set(group,[]); groups.get(group).push(e); }
    $('#results').innerHTML = [...groups].map(([year, group])=>`<section class="timeline-group"><h2>${esc(year)}</h2><div class="entries-grid">${group.map(card).join('')}</div></section>`).join('');
  } else $('#results').innerHTML = `<div class="entries-grid">${rows.map(card).join('')}</div>`;
}
function render() {
  if (!['all','favorites','life','gallery',...sections.map(s=>s.id)].includes(active)) active = 'all';
  nav();
  const section = sectionById(active);
  const titles = {all:'My journal',favorites:'Favorites',life:'Life timeline',gallery:'Memory box'};
  const mainTitle = titles[active] || section.name;
  $('#breadcrumb').textContent = mainTitle;
  const prompts = titles[active] ? sectionById('journal').prompts : section.prompts;
  $('#main').innerHTML = `<div class="page-heading"><div><p class="eyebrow">${new Date().toLocaleDateString(undefined,{month:'long',day:'numeric',year:'numeric'})}</p><h1>${esc(mainTitle)}</h1></div><button class="primary" data-action="new">Write <span aria-hidden="true">＋</span></button></div><div class="journal-tools"><span id="result-count" class="count"></span><details class="filter-details"><summary>Search & filter</summary><div class="toolbar"><label class="search-wrap"><span class="sr-only">Search entries</span><input id="search" placeholder="Search your journal…" value="${esc(query)}" type="search"></label>${active === 'life' ? `<select id="chapter-filter" aria-label="Filter by life chapter"><option value="">All life chapters</option>${chapters.map(c=>`<option ${chapterFilter===c?'selected':''}>${esc(c)}</option>`).join('')}</select>` : `<select id="mood-filter" aria-label="Filter by mood"><option value="">Any mood</option>${['Great','Good','Okay','Low','Difficult'].map(m=>`<option ${moodFilter===m?'selected':''}>${m}</option>`).join('')}</select>`}<select id="sort" aria-label="Sort entries"><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="updated">Recently edited</option></select><button data-action="clear-filters" class="text-button">Clear</button></div></details></div><div id="results" class="${active==='gallery'?'gallery-view':''}"></div><details class="writing-prompts"><summary>A little inspiration</summary><div class="prompt-list" aria-label="Writing prompts">${prompts.map(p=>`<button class="prompt-chip" data-prompt="${esc(p)}" data-section="${titles[active]?'journal':section.id}">${esc(p)} <span aria-hidden="true">↗</span></button>`).join('')}</div></details>`;
  $('.filter-details').open = Boolean(query || moodFilter || chapterFilter || sort !== 'newest');
  $('#search').addEventListener('input',event=>{query=event.target.value;renderResults();});
  $('#mood-filter')?.addEventListener('change',event=>{moodFilter=event.target.value;renderResults();});
  $('#chapter-filter')?.addEventListener('change',event=>{chapterFilter=event.target.value;renderResults();});
  $('#sort').value=sort; $('#sort').addEventListener('change',event=>{sort=event.target.value;renderResults();});
  renderResults();
}
window.addEventListener('hashchange',()=>{ active=location.hash.slice(1)||'all';query='';moodFilter='';chapterFilter='';setNavigation(false);render(); });
function setNavigation(open) { document.body.classList.toggle('nav-open',open); $('#menu').setAttribute('aria-expanded',String(open)); $('#navigation').open=open; }
$('#menu').addEventListener('click',()=>{ setNavigation(!$('#navigation').open); });
$('#navigation').addEventListener('toggle',()=>{document.body.classList.toggle('nav-open',$('#navigation').open);$('#menu').setAttribute('aria-expanded',String($('#navigation').open));});
document.addEventListener('keydown',event=>{if(event.key==='Escape' && $('#navigation').open){setNavigation(false);$('#menu').focus();}});
document.addEventListener('click',event=>{if($('#navigation').open && !event.target.closest('#navigation') && !event.target.closest('#menu'))setNavigation(false);});
document.addEventListener('click',async event=>{
  const entry=event.target.closest('[data-entry]');
  const prompt=event.target.closest('[data-prompt]');
  const action=event.target.closest('[data-action]')?.dataset.action;
  try {
    if(entry) await openEditor(await api(`/api/entries/${entry.dataset.entry}`));
    else if(prompt) await openEditor(null,prompt.dataset.section,prompt.dataset.prompt);
    else if(action==='new') await openEditor(null,sections.some(s=>s.id===active)?active:'journal');
    else if(action==='chapter') await openEditor(null,'timeline','', '2026 — Rebuilding');
    else if(action==='clear-filters'){query='';moodFilter='';chapterFilter='';sort='newest';render();}
  } catch(error){toast(error.message);}
});
$('#entry-section').innerHTML=sections.map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join('');
$('#entry-chapter').innerHTML='<option value="">No chapter</option>'+chapters.map(c=>`<option>${esc(c)}</option>`).join('');
function editorPrompts(){ $('#editor-prompts').innerHTML=sectionById($('#entry-section').value).prompts.map(p=>`<button type="button" class="prompt-chip" data-insert="${esc(p)}">${esc(p)}</button>`).join(''); }
async function openEditor(entry=null,section='journal',prompt='',chapter=''){
  setNavigation(false);editing=entry;dirty=false;$('#entry-details').open=false;$('#prompt-details').open=false;$('#memory-details').open=false;$('#editor-error').textContent='';$('#attachments').innerHTML='';
  $('#entry-title').value=entry?.title||prompt;$('#entry-content').value=entry?.content||'';$('#entry-section').value=entry?.section||section;$('#entry-date').value=entry?.date||localDate();$('#entry-chapter').value=entry?.chapter||chapter;$('#entry-mood').value=entry?.mood||'';$('#entry-tags').value=entry?.tags||'';$('#entry-favorite').checked=Boolean(entry?.favorite);
  $('#editor-label').textContent=entry?formatDate(entry.date):'New entry';$('#delete-entry').hidden=!entry;$('#upload').disabled=!entry;$('#upload-help').textContent=entry?'Photos, voice notes, videos, or documents. Up to 25 MB each; 20 attachments per entry.':'Save your entry first to add photos, voice notes, videos, or documents. Up to 25 MB each.';$('#save-status').textContent=entry?'Saved':'Not saved yet';wordCount();editorPrompts();$('#editor').showModal();document.body.classList.add('modal-open');
  if(prompt)$('#entry-content').focus();else $('#entry-title').focus();
  if(entry)try{await loadAttachments();}catch(error){$('#editor-error').textContent=error.message;}
}
function wordCount(){const value=$('#entry-content').value.trim();$('#word-count').textContent=`${value?value.split(/\s+/).length:0} words`;}
$('#entry-form').addEventListener('input',()=>{dirty=true;$('#save-status').textContent='Unsaved changes';wordCount();});
$('#entry-section').addEventListener('change',editorPrompts);
$('#editor-prompts').addEventListener('click',event=>{const prompt=event.target.closest('[data-insert]');if(!prompt)return;const field=$('#entry-content');field.value+=(field.value?'\n\n':'')+prompt.dataset.insert+'\n';field.dispatchEvent(new Event('input',{bubbles:true}));field.focus();});
function closeEditor(){if(busy){toast('Please wait for the current save or upload.');return;}if(dirty&&!confirm('Discard your unsaved changes?'))return;$('#editor').close();document.body.classList.remove('modal-open');dirty=false;}
$('#close-editor').addEventListener('click',closeEditor);$('#editor').addEventListener('cancel',event=>{event.preventDefault();closeEditor();});
window.addEventListener('beforeunload',event=>{if(dirty||busy){event.preventDefault();event.returnValue='';}});
function entryPayload(){return{title:$('#entry-title').value,content:$('#entry-content').value,section:$('#entry-section').value,date:$('#entry-date').value,chapter:$('#entry-chapter').value,mood:$('#entry-mood').value,tags:$('#entry-tags').value,favorite:$('#entry-favorite').checked,updated:editing?.updated};}
function setBusy(value){busy=value;$('#save-entry').disabled=value;$('#delete-entry').disabled=value;$('#upload').disabled=value||!editing;}
$('#entry-form').addEventListener('submit',async event=>{
  event.preventDefault();if(busy)return;setBusy(true);$('#editor-error').textContent='';
  const snapshot=JSON.stringify(entryPayload());
  try{editing=await api(editing?`/api/entries/${editing.id}`:'/api/entries',{method:editing?'PUT':'POST',body:snapshot});const current=entryPayload();const saved=JSON.parse(snapshot);current.updated=saved.updated;dirty=JSON.stringify(current)!==snapshot;$('#save-status').textContent=dirty?'Unsaved changes':'Saved just now';$('#delete-entry').hidden=false;$('#upload-help').textContent='Photos, voice notes, videos, or documents. Up to 25 MB each; 20 attachments per entry.';toast('Entry saved');entries=await api('/api/entries');render();}
  catch(error){$('#editor-error').textContent=error.message;}
  finally{setBusy(false);}
});
$('#delete-entry').addEventListener('click',async()=>{if(!editing||busy||!confirm('Delete this entry and all its attachments? This cannot be undone.'))return;setBusy(true);try{await api(`/api/entries/${editing.id}`,{method:'DELETE'});dirty=false;setBusy(false);closeEditor();entries=await api('/api/entries');render();toast('Entry deleted');}catch(error){$('#editor-error').textContent=error.message;}finally{setBusy(false);}});
async function loadAttachments(){
  const files=await api(`/api/entries/${editing.id}/attachments`);
  $('#attachments').innerHTML=files.map(file=>`<div class="attachment">${file.type.startsWith('image/')?`<a href="/api/attachments/${file.id}" target="_blank" rel="noopener"><img src="/api/attachments/${file.id}" alt="${esc(file.name)}"></a>`:file.type.startsWith('audio/')?`<audio controls preload="metadata" src="/api/attachments/${file.id}"></audio>`:file.type.startsWith('video/')?`<video controls preload="metadata" src="/api/attachments/${file.id}"></video>`:''}<div class="attachment-row"><a href="/api/attachments/${file.id}?download=1" download>${esc(file.name)} ↓</a><button type="button" data-remove="${file.id}" aria-label="Remove ${esc(file.name)}">×</button></div></div>`).join('');
}
$('#upload').addEventListener('change',async event=>{if(!editing||busy)return;const files=[...event.target.files];if(!files.length)return;setBusy(true);$('#editor-error').textContent='';try{for(const file of files){if(file.size>25*1024*1024)throw new Error(`${file.name} is larger than 25 MB.`);$('#save-status').textContent=`Uploading ${file.name}…`;await api(`/api/entries/${editing.id}/attachments`,{method:'POST',headers:{'Content-Type':'application/octet-stream','X-File-Name':encodeURIComponent(file.name)},body:file});}toast('Memories attached');}catch(error){$('#editor-error').textContent=error.message;}finally{event.target.value='';try{await loadAttachments();entries=await api('/api/entries');render();}catch(error){$('#editor-error').textContent=error.message;}$('#save-status').textContent=dirty?'Unsaved changes':'Saved';setBusy(false);}});
$('#attachments').addEventListener('click',async event=>{const button=event.target.closest('[data-remove]');if(!button||busy||!confirm('Remove this attachment?'))return;setBusy(true);try{await api(`/api/attachments/${button.dataset.remove}`,{method:'DELETE'});await loadAttachments();entries=await api('/api/entries');render();toast('Attachment removed');}catch(error){$('#editor-error').textContent=error.message;}finally{setBusy(false);}});
try{await start();}catch(error){$('#main').innerHTML=`<div class="error-panel"><h1>Couldn’t open your journal.</h1><p>${esc(error.message)}</p><button class="primary" data-action="retry">Try again</button></div>`;}
document.addEventListener('click',async event=>{if(event.target.closest('[data-action="retry"]')){try{await start();}catch(error){toast(error.message);}}});

// Optional browser agent integration opens an editor; it never silently saves personal writing.
if(document.modelContext?.registerTool){
  const lifecycle=new AbortController();
  try{Promise.resolve(document.modelContext.registerTool({name:'start_journal_entry',title:'Start a journal entry',description:'Open an unsaved journal entry in the visible editor. Does not save it.',inputSchema:{type:'object',properties:{section:{type:'string',enum:sections.map(s=>s.id)},prompt:{type:'string',maxLength:200}},required:['section'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:false},async execute(input){if(!input||!sections.some(s=>s.id===input.section)||('prompt'in input&&(typeof input.prompt!=='string'||input.prompt.length>200)))throw new Error('Invalid section or prompt.');if($('#editor').open)throw new Error('Close the current entry first.');await openEditor(null,input.section,input.prompt||'');return{status:'editor_open',saved:false};}},{signal:lifecycle.signal})).catch(()=>{});}catch{}
  window.addEventListener('pagehide',()=>lifecycle.abort(),{once:true});
}
