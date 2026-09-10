import { sections, chapters } from './sections.js';
import { onThisDay, newId, createDraftStore, createAutosaver } from './journal-utils.js';
const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const sectionById = id => sections.find(s => s.id === id) || sections.find(s => s.id === 'journal');
const localDate = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
const formatDate = date => new Date(`${date}T12:00:00`).toLocaleDateString(undefined,{ month:'short',day:'numeric',year:'numeric' });
let entries = [], active = 'all', query = '', moodFilter = '', chapterFilter = '', sort = 'newest', topicFilter = '', editing = null, dirty = false, busy = false, toastTimer;
async function api(url, options = {}) {
  const headers = { 'X-Journal-Request': '1', ...options.headers };
  if (options.body && typeof options.body === 'string') headers['Content-Type'] = 'application/json';
  const response = await fetch(url, { ...options, headers });
  const data = await response.json();
  if (!response.ok) {
    throw Object.assign(new Error(data.error || 'Something went wrong. Please try again.'), {status:response.status});
  }
  return data;
}
function toast(message) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').hidden = true, 5000); }
async function start() { entries = await api('/api/entries'); readRoute(); render(); }
function nav() {
  const primary = [['outline','Life outline','☷'],['anniversary','On this day','◷'],['all','All entries','▤'],['favorites','Favorites','☆'],['life','Life timeline','⌁'],['gallery','Memory box','▧']];
  const navItem = (id,name,icon,count) => `<a class="nav-item ${active === id ? 'active' : ''}" href="#${id}" ${active === id ? 'aria-current="page"' : ''}><span class="nav-icon" aria-hidden="true">${icon}</span><span>${esc(name)}</span>${count ? `<span class="nav-count">${count}</span>` : ''}</a>`;
  $('#main-nav').innerHTML = primary.map(([id,name,icon]) => navItem(id,name,icon,id === 'all' ? entries.length : '')).join('');
  $('#section-nav').innerHTML = sections.map(s => navItem(s.id,s.name,s.icon,entries.filter(e=>e.section===s.id).length)).join('');
}
function card(entry) {
  const section = sectionById(entry.section);
  return `<button class="entry-card" data-entry="${entry.id}"><span class="entry-date">${esc(formatDate(entry.date))}</span><span class="entry-body">${active === 'gallery' && entry.cover ? `<img class="card-image" loading="lazy" src="/api/attachments/${entry.cover}" alt="">` : ''}<span class="entry-title">${esc(entry.title)}${entry.favorite ? '<span class="favorite-star" aria-label="Favorite"> · ★</span>' : ''}</span><span class="entry-excerpt">${esc(entry.content || 'A moment saved for later.')}</span><span class="card-meta">${esc(section.name)}${entry.topic ? ` / ${esc(entry.topic)}` : ''}${active === 'anniversary' ? ` · ${Number(localDate().slice(0,4))-Number(entry.date.slice(0,4))} years ago` : ''}${entry.attachment_count ? ` · ${entry.attachment_count} attachment${entry.attachment_count === 1 ? '' : 's'}` : ''}</span></span><span class="entry-arrow" aria-hidden="true">↗</span></button>`;
}
function filteredEntries() {
  const needle = query.toLocaleLowerCase();
  const source = active === 'anniversary' ? onThisDay(entries,localDate()) : entries;
  const rows = source.filter(e => (active === 'all' || active === 'anniversary' || active === 'life' || (active === 'favorites' && e.favorite) || (active === 'gallery' && (e.attachment_count || e.section === 'memories')) || e.section === active) && (!topicFilter || e.topic === topicFilter) && (!moodFilter || e.mood === moodFilter) && (!chapterFilter || e.chapter === chapterFilter) && (!needle || [e.title,e.content,e.tags,e.chapter,e.topic||'',sectionById(e.section).name].some(s => s.toLocaleLowerCase().includes(needle))));
  return rows.sort((a,b) => sort === 'oldest' ? a.date.localeCompare(b.date) : sort === 'updated' ? b.updated.localeCompare(a.updated) : b.date.localeCompare(a.date));
}
function renderResults() {
  const rows = filteredEntries(); $('#result-count').textContent = `${rows.length} ${rows.length === 1 ? 'entry' : 'entries'}`;
  if (!rows.length) {
    const hasFilter = query || moodFilter || chapterFilter;
    $('#results').innerHTML = `<div class="empty-state"><div class="empty-symbol" aria-hidden="true">${active==='gallery'?'▧':'▤'}</div><h2>${hasFilter ? 'No entries found' : active === 'anniversary' ? 'Nothing from this day yet.' : active === 'favorites' ? 'Keep the moments you love' : active === 'gallery' ? 'A home for your keepsakes' : 'A blank page.'}</h2><p>${hasFilter ? 'Try a different search or clear your filters.' : active === 'anniversary' ? 'Entries from this date in earlier years will appear here.' : active === 'favorites' ? 'Mark an entry as a favorite to find it here.' : active === 'gallery' ? 'Add photos, voice notes, tickets, and videos to an entry. Find those entries together here.' : 'Begin with whatever is on your mind.'}</p><button class="primary" data-action="${hasFilter ? 'clear-filters' : 'new'}">${hasFilter ? 'Clear filters' : 'Write an entry'} <span>↗</span></button></div>`;
  } else if (active === 'life') {
    const groups = new Map();
    for (const e of rows) { const group = e.date.slice(0,4); if (!groups.has(group)) groups.set(group,[]); groups.get(group).push(e); }
    $('#results').innerHTML = [...groups].map(([year, group])=>`<section class="timeline-group"><h2>${esc(year)}</h2><div class="entries-grid">${group.map(card).join('')}</div></section>`).join('');
  } else $('#results').innerHTML = `<div class="entries-grid">${rows.map(card).join('')}</div>`;
}
function render() {
  if (!['all','favorites','life','gallery','outline','anniversary',...sections.map(s=>s.id)].includes(active)) active = 'all';
  nav();
  if(active === 'outline'){renderOutline();return;}
  const section = sectionById(active);
  const titles = {anniversary:'On this day',all:'My journal',favorites:'Favorites',life:'Life timeline',gallery:'Memory box'};
  const mainTitle = topicFilter || titles[active] || section.name;
  $('#breadcrumb').textContent = mainTitle;
  const prompts = titles[active] ? sectionById('journal').prompts : section.prompts;
  $('#main').innerHTML = `<div class="page-heading"><div><p class="eyebrow">${new Date().toLocaleDateString(undefined,{month:'long',day:'numeric',year:'numeric'})}</p><h1>${esc(mainTitle)}</h1>${topicFilter ? `<a class="topic-parent" href="#${section.id}">${esc(section.name)} / All topics</a>` : ''}</div><button class="primary" data-action="new">Write <span aria-hidden="true">＋</span></button></div>${active === 'all' ? `<div class="quiet-links"><a href="#outline">Life outline</a><a href="#anniversary">On this day${onThisDay(entries,localDate()).length ? ` · ${onThisDay(entries,localDate()).length}` : ''}</a></div>` : ''}<div id="recovery"></div><div class="journal-tools"><span id="result-count" class="count"></span><details class="filter-details"><summary>Search & filter</summary><div class="toolbar"><label class="search-wrap"><span class="sr-only">Search entries</span><input id="search" placeholder="Search your journal…" value="${esc(query)}" type="search"></label>${active === 'life' ? `<select id="chapter-filter" aria-label="Filter by life chapter"><option value="">All life chapters</option>${chapters.map(c=>`<option ${chapterFilter===c?'selected':''}>${esc(c)}</option>`).join('')}</select>` : `<select id="mood-filter" aria-label="Filter by mood"><option value="">Any mood</option>${['Great','Good','Okay','Low','Difficult'].map(m=>`<option ${moodFilter===m?'selected':''}>${m}</option>`).join('')}</select>`}<select id="sort" aria-label="Sort entries"><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="updated">Recently edited</option></select><button data-action="clear-filters" class="text-button">Clear</button></div></details></div><div id="results" class="${active==='gallery'?'gallery-view':''}"></div><details class="writing-prompts"><summary>A little inspiration</summary><div class="prompt-list" aria-label="Writing prompts">${prompts.map(p=>`<button class="prompt-chip" data-prompt="${esc(p)}" data-section="${titles[active]?'journal':section.id}">${esc(p)} <span aria-hidden="true">↗</span></button>`).join('')}</div></details>`;
  $('.filter-details').open = Boolean(query || moodFilter || chapterFilter || sort !== 'newest');
  $('#search').addEventListener('input',event=>{query=event.target.value;renderResults();});
  $('#mood-filter')?.addEventListener('change',event=>{moodFilter=event.target.value;renderResults();});
  $('#chapter-filter')?.addEventListener('change',event=>{chapterFilter=event.target.value;renderResults();});
  $('#sort').value=sort; $('#sort').addEventListener('change',event=>{sort=event.target.value;renderResults();});
  renderResults(); renderRecovery();
}
function readRoute(){const [section,topic]=location.hash.slice(1).split('/');active=section||'all';try{topicFilter=decodeURIComponent(topic||'');}catch{topicFilter='';}if(!sections.find(s=>s.id===active)?.prompts.includes(topicFilter))topicFilter='';}
window.addEventListener('hashchange',()=>{readRoute();query='';moodFilter='';chapterFilter='';setNavigation(false);render();});
let renderedDay=localDate();
window.addEventListener('focus',()=>{if(renderedDay!==localDate()){renderedDay=localDate();render();}});
function setNavigation(open) { document.body.classList.toggle('nav-open',open); $('#menu').setAttribute('aria-expanded',String(open)); $('#navigation').open=open; }
$('#menu').addEventListener('click',()=>{ setNavigation(!$('#navigation').open); });
$('#navigation').addEventListener('toggle',()=>{document.body.classList.toggle('nav-open',$('#navigation').open);$('#menu').setAttribute('aria-expanded',String($('#navigation').open));});
document.addEventListener('keydown',event=>{if(event.key==='Escape' && $('#navigation').open){setNavigation(false);$('#menu').focus();}});
document.addEventListener('click',event=>{if($('#navigation').open && !event.target.closest('#navigation') && !event.target.closest('#menu'))setNavigation(false);});
document.addEventListener('click',async event=>{
  const entry=event.target.closest('[data-entry]');
  const prompt=event.target.closest('[data-prompt]');
  const action=event.target.closest('[data-action]')?.dataset.action;
  const outlineWrite=event.target.closest('[data-outline-write]');
  try {
    if(outlineWrite) await openEditor(null,outlineWrite.dataset.outlineWrite,'','',outlineWrite.dataset.topic||'');
    else if(entry) await openEditor(await api(`/api/entries/${entry.dataset.entry}`));
    else if(prompt) await openEditor(null,prompt.dataset.section,prompt.dataset.prompt,'',topicFilter||prompt.dataset.prompt);
    else if(action==='new') await openEditor(null,sections.some(s=>s.id===active)?active:'journal','','',topicFilter);
    else if(action==='chapter') await openEditor(null,'timeline','', '2026 — Rebuilding');
    else if(action==='clear-filters'){query='';moodFilter='';chapterFilter='';sort='newest';render();}
  } catch(error){toast(error.message);}
});
$('#entry-section').innerHTML=sections.map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join('');
$('#entry-chapter').innerHTML='<option value="">No chapter</option>'+chapters.map(c=>`<option>${esc(c)}</option>`).join('');
let saver=null, draftKey=null;
let draftStore;
try{draftStore=createDraftStore(window.localStorage);}catch{draftStore={list:()=>[],put:()=>{throw new Error('Browser recovery unavailable');},remove:()=>{}};}
function drafts(){try{return draftStore.list();}catch{return[];}}
function renderRecovery(){
  const slot=$('#recovery');if(!slot)return;const pending=drafts();
  slot.innerHTML=pending.length?`<details class="recovery-list"><summary>Unfinished writing · ${pending.length}</summary>${pending.map(d=>`<div class="recovery-row"><button data-recover="${esc(d.key)}">Resume ${esc(d.latest.title||'Untitled entry')}</button><button class="danger-quiet" data-discard-draft="${esc(d.key)}">Discard draft</button></div>`).join('')}</details>`:'';
}
window.addEventListener('storage',renderRecovery);
document.addEventListener('click',async event=>{
  const recover=event.target.closest('[data-recover]');const discard=event.target.closest('[data-discard-draft]');
  if(recover){const draft=drafts().find(d=>d.key===recover.dataset.recover);if(draft)await openEditor(draft.entry,'journal','','','',draft);}
  if(discard && confirm('Discard this browser draft? Saved journal entries will stay.')){try{draftStore.remove(discard.dataset.discardDraft);renderRecovery();}catch(error){toast(error.message);}}
});
function editorPrompts(){ $('#editor-prompts').innerHTML=sectionById($('#entry-section').value).prompts.map(p=>`<button type="button" class="prompt-chip" data-insert="${esc(p)}">${esc(p)}</button>`).join(''); }
function topicOptions(selected=''){$('#entry-topic').innerHTML='<option value="">General entry</option>'+sectionById($('#entry-section').value).prompts.map(p=>`<option>${esc(p)}</option>`).join('');$('#entry-topic').value=selected;}
function entryPayload(){return{title:$('#entry-title').value,content:$('#entry-content').value,section:$('#entry-section').value,topic:$('#entry-topic').value||'',date:$('#entry-date').value,chapter:$('#entry-chapter').value,mood:$('#entry-mood').value,tags:$('#entry-tags').value,favorite:$('#entry-favorite').checked};}
function saveState(state){
  dirty=state.dirty;editing=state.entry||editing;
  const labels={pending:'Waiting to save…',saving:'Saving…',saved:'Saved to journal',draft:state.recoverable?'Draft on this device':'Not saved yet',error:state.recoverable?'Draft on this device':'Not saved',conflict:'Draft on this device'};
  $('#save-status').textContent=labels[state.status];
  $('#editor-error').textContent=state.status==='error'?(state.error?.status>=400&&state.error?.status<500?state.error.message:state.recoverable?'Could not reach your journal. Your writing is kept on this device; retrying automatically.': 'Could not save or keep a recovery copy. Keep this page open and copy your writing.') : state.status==='conflict'?(state.error?.message||'This entry changed elsewhere. Your draft is kept for recovery.') : '';
  $('#delete-entry').hidden=!editing;$('#upload').disabled=busy||!editing;
  if(editing)$('#upload-help').textContent='Photos, voice notes, videos, or documents. Up to 25 MB each; 20 attachments per entry.';
  if(state.status==='saved')renderRecovery();
}
async function openEditor(entry=null,section='journal',prompt='',chapter='',topic='',recovery=null){
  if($('#editor').open)return;
  setNavigation(false);editing=entry;dirty=false;$('#entry-details').open=false;$('#prompt-details').open=false;$('#memory-details').open=false;$('#editor-error').textContent='';$('#attachments').innerHTML='';
  const values=recovery?.latest||entry||{title:prompt,content:'',section,date:localDate(),chapter:chapter||(section==='timeline'&&chapters.includes(topic)?topic:''),mood:'',tags:'',favorite:false,topic:sectionById(section).prompts.includes(topic)?topic:''};
  $('#entry-title').value=values.title;$('#entry-content').value=values.content;$('#entry-section').value=values.section;$('#entry-date').value=values.date;$('#entry-chapter').value=values.chapter;$('#entry-mood').value=values.mood;$('#entry-tags').value=values.tags;$('#entry-favorite').checked=Boolean(values.favorite);topicOptions(values.topic||'');
  $('#editor-label').textContent=entry?formatDate(entry.date):'New entry';$('#delete-entry').hidden=!entry;$('#upload').disabled=!entry;$('#upload-help').textContent=entry?'Photos, voice notes, videos, or documents. Up to 25 MB each; 20 attachments per entry.':'Start writing to autosave your entry, then add attachments.';$('#save-status').textContent=entry?'Saved to journal':'Autosave is on';wordCount();editorPrompts();
  draftKey=recovery?.key||newId();
  saver=createAutosaver({initial:entryPayload(),entry,targetId:entry?.id||newId(),draftKey,restored:recovery,store:draftStore,uuid:newId,request:(url,options)=>api(url,{...options,signal:AbortSignal.timeout(20000)}),onState:saveState,onSaved(result){editing=result;const old=entries.find(e=>e.id===result.id);const row={...old,...result,attachment_count:old?.attachment_count||0,cover:old?.cover||null};entries=entries.filter(e=>e.id!==result.id);entries.push(row);render();}});
  $('#editor').showModal();document.body.classList.add('modal-open');
  if(recovery)saver.resume();
  if(prompt||recovery)$('#entry-content').focus();else $('#entry-title').focus();
  if(entry)try{await loadAttachments();}catch(error){$('#editor-error').textContent=error.message;}
}
function wordCount(){const value=$('#entry-content').value.trim();$('#word-count').textContent=`${value?value.split(/\s+/).length:0} words`;}
function changed(){wordCount();saver?.update(entryPayload());}
$('#entry-form').addEventListener('input',event=>{if(event.target.id!=='upload'&&event.target.id!=='entry-section')changed();});
$('#entry-section').addEventListener('change',()=>{topicOptions();editorPrompts();changed();});
$('#entry-topic').addEventListener('change',()=>{if($('#entry-section').value==='timeline'&&chapters.includes($('#entry-topic').value))$('#entry-chapter').value=$('#entry-topic').value;changed();});
$('#editor-prompts').addEventListener('click',event=>{const prompt=event.target.closest('[data-insert]');if(!prompt)return;const field=$('#entry-content');field.value+=(field.value?'\n\n':'')+prompt.dataset.insert+'\n';changed();field.focus();});
async function closeEditor(){
  if(busy){toast('Please wait for the upload.');return;}
  try{await saver?.flush();}catch{}
  if(saver?.dirty&&!saver.recoverable&&!confirm('Saving failed and browser recovery is unavailable. Discard your changes?'))return;
  if(saver?.dirty&&saver.recoverable)toast('Unfinished writing is kept on this device.');
  saver?.dispose();saver=null;$('#editor').close();document.body.classList.remove('modal-open');dirty=false;renderRecovery();
}
$('#close-editor').addEventListener('click',()=>void closeEditor());$('#editor').addEventListener('cancel',event=>{event.preventDefault();void closeEditor();});
window.addEventListener('beforeunload',event=>{if(busy||(saver?.dirty&&!saver.recoverable)){event.preventDefault();event.returnValue='';}});
document.addEventListener('visibilitychange',()=>{if(document.hidden)void saver?.flush().catch(()=>{});});
window.addEventListener('online',()=>{void saver?.flush().catch(()=>{});});
function setBusy(value){busy=value;$('#save-entry').disabled=value;$('#delete-entry').disabled=value;$('#upload').disabled=value||!editing;}
$('#entry-form').addEventListener('submit',async event=>{event.preventDefault();if(busy)return;try{saver?.update(entryPayload());const saved=await saver?.flush();if(saved)toast('Entry saved');}catch{}});
$('#entry-form').addEventListener('invalid',event=>{if(event.target.closest('#entry-details'))$('#entry-details').open=true;},true);
$('#delete-entry').addEventListener('click',async()=>{
  if(!editing||busy||!confirm('Delete this entry and all its attachments? This cannot be undone.'))return;
  setBusy(true);$('#entry-form').inert=true;
  try{await saver.flush();await api(`/api/entries/${editing.id}`,{method:'DELETE'});saver.discard();saver=null;dirty=false;$('#editor').close();document.body.classList.remove('modal-open');entries=entries.filter(e=>e.id!==editing.id);render();toast('Entry deleted');}catch(error){$('#editor-error').textContent=error.message;}finally{$('#entry-form').inert=false;setBusy(false);}
});
async function loadAttachments(){
  const files=await api(`/api/entries/${editing.id}/attachments`);
  $('#attachments').innerHTML=files.map(file=>`<div class="attachment">${file.type.startsWith('image/')?`<a href="/api/attachments/${file.id}" target="_blank" rel="noopener"><img src="/api/attachments/${file.id}" alt="${esc(file.name)}"></a>`:file.type.startsWith('audio/')?`<audio controls preload="metadata" src="/api/attachments/${file.id}"></audio>`:file.type.startsWith('video/')?`<video controls preload="metadata" src="/api/attachments/${file.id}"></video>`:''}<div class="attachment-row"><a href="/api/attachments/${file.id}?download=1" download>${esc(file.name)} ↓</a><button type="button" data-remove="${file.id}" aria-label="Remove ${esc(file.name)}">×</button></div></div>`).join('');
}
$('#upload').addEventListener('change',async event=>{if(!editing||busy)return;const files=[...event.target.files];if(!files.length)return;setBusy(true);$('#editor-error').textContent='';try{await saver.flush();for(const file of files){if(file.size>25*1024*1024)throw new Error(`${file.name} is larger than 25 MB.`);$('#save-status').textContent=`Uploading ${file.name}…`;await api(`/api/entries/${editing.id}/attachments`,{method:'POST',headers:{'Content-Type':'application/octet-stream','X-File-Name':encodeURIComponent(file.name)},body:file});}toast('Memories attached');}catch(error){$('#editor-error').textContent=error.message;}finally{event.target.value='';try{await loadAttachments();entries=await api('/api/entries');render();}catch(error){$('#editor-error').textContent=error.message;}$('#save-status').textContent=dirty?'Waiting to save…':'Saved to journal';setBusy(false);}});
$('#attachments').addEventListener('click',async event=>{const button=event.target.closest('[data-remove]');if(!button||busy||!confirm('Remove this attachment?'))return;setBusy(true);try{await saver.flush();await api(`/api/attachments/${button.dataset.remove}`,{method:'DELETE'});await loadAttachments();entries=await api('/api/entries');render();toast('Attachment removed');}catch(error){$('#editor-error').textContent=error.message;}finally{setBusy(false);}});
function renderOutline(){
  const expanded=new Set([...document.querySelectorAll('[data-outline-section][open]')].map(el=>el.dataset.outlineSection));
  $('#breadcrumb').textContent='Life outline';
  $('#main').innerHTML=`<div class="page-heading"><div><p class="eyebrow">Charlie — Life Journal</p><h1>Life outline</h1></div></div><p class="outline-intro">Your original sections and topics. A place for every part of your story.</p><div id="recovery"></div><div class="outline-tree">${sections.map(section=>{
    const rows=entries.filter(e=>e.section===section.id);const general=rows.filter(e=>!e.topic).length;
    return `<details data-outline-section="${section.id}" ${expanded.has(section.id)?'open':''}><summary>${esc(section.name)}<span class="outline-count">${rows.length}</span></summary><div class="outline-items"><a class="outline-all" href="#${section.id}">All entries · ${rows.length}${general?` (${general} general)`:''}</a>${section.prompts.map(topic=>{const count=rows.filter(e=>e.topic===topic).length;return `<div class="outline-topic ${section.subsections.includes(topic)?'outline-subsection':''}"><a href="#${section.id}/${encodeURIComponent(topic)}">${esc(topic)}${count?` <span class="outline-count">${count}</span>`:''}</a><button data-outline-write="${section.id}" data-topic="${esc(topic)}" aria-label="Write under ${esc(section.name)}: ${esc(topic)}">＋</button></div>`;}).join('')}</div></details>`;
  }).join('')}</div>`;
  renderRecovery();
}
try{await start();}catch(error){$('#main').innerHTML=`<div class="error-panel"><h1>Couldn’t open your journal.</h1><p>${esc(error.message)}</p><button class="primary" data-action="retry">Try again</button></div><div id="recovery"></div>`;renderRecovery();}
document.addEventListener('click',async event=>{if(event.target.closest('[data-action="retry"]')){try{await start();}catch(error){toast(error.message);}}});

// Optional browser agent integration opens an editor; it follows the same autosave behavior as the visible editor.
if(document.modelContext?.registerTool){
  const lifecycle=new AbortController();
  try{Promise.resolve(document.modelContext.registerTool({name:'start_journal_entry',title:'Start a journal entry',description:'Open a journal editor. Typing autosaves to the journal; opening alone does not save.',inputSchema:{type:'object',properties:{section:{type:'string',enum:sections.map(s=>s.id)},prompt:{type:'string',maxLength:200}},required:['section'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:false},async execute(input){if(!input||!sections.some(s=>s.id===input.section)||('prompt'in input&&(typeof input.prompt!=='string'||input.prompt.length>200)))throw new Error('Invalid section or prompt.');if($('#editor').open)throw new Error('Close the current entry first.');await openEditor(null,input.section,input.prompt||'');return{status:'editor_open',saved:false};}},{signal:lifecycle.signal})).catch(()=>{});}catch{}
  window.addEventListener('pagehide',()=>lifecycle.abort(),{once:true});
}
