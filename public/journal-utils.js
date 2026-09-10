export function newId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map(byte => byte.toString(16).padStart(2,'0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

export function onThisDay(entries, today) {
  return entries.filter(entry => entry.date.slice(5) === today.slice(5) && entry.date.slice(0,4) < today.slice(0,4))
    .sort((a,b) => b.date.localeCompare(a.date));
}

export function createDraftStore(storage) {
  const prefix = 'charlie-journal:draft:';
  return {
    put(key, value) { storage.setItem(prefix + key, JSON.stringify(value)); },
    remove(key) { storage.removeItem(prefix + key); },
    list() {
      const drafts = [];
      for (let i=0;i<storage.length;i++) {
        const key=storage.key(i);
        if (!key?.startsWith(prefix)) continue;
        try {
          const draft=JSON.parse(storage.getItem(key));
          if (draft?.version === 1 && typeof draft.targetId === 'string' && typeof draft.latest?.content === 'string' && typeof draft.latest?.title === 'string') drafts.push({key:key.slice(prefix.length),...draft});
        } catch { /* Ignore incomplete or unrelated local records. */ }
      }
      return drafts.sort((a,b) => (b.savedAt || '').localeCompare(a.savedAt || ''));
    }
  };
}

// One writer per editor. A failed request keeps its exact mutation ID and payload
// so a lost response can be retried without creating a duplicate or overwriting edits.
export function createAutosaver({ initial, entry=null, targetId, draftKey, restored=null, store, request, uuid,
  onState=()=>{}, onSaved=()=>{}, delay=1200, retryDelay=5000, timers=globalThis }) {
  let latest=structuredClone(restored?.latest || initial);
  let saved=restored?.saved ?? JSON.stringify(initial);
  let current=restored?.entry || entry;
  let pending=restored?.pending || null;
  let timer=null, inflight=null, stopped=false, recoverable=false, conflict=false;
  targetId=restored?.targetId || targetId;
  const dirty=()=>pending!==null || JSON.stringify(latest)!==saved;
  function persist() {
    try {
      if (!dirty()) { store.remove(draftKey); recoverable=false; return; }
      store.put(draftKey,{version:1,targetId,latest,saved,entry:current,pending,savedAt:new Date().toISOString()});
      recoverable=true;
    } catch { recoverable=false; }
  }
  function state(status,error=null) { onState({status,error,dirty:dirty(),recoverable,entry:current}); }
  function schedule(ms) { timers.clearTimeout(timer); if(!stopped&&!conflict)timer=timers.setTimeout(()=>{void flush().catch(()=>{});},ms); }
  async function run() {
    while (!stopped && dirty()) {
      if (!pending) {
        if (!current && !latest.title.trim() && !latest.content.trim()) { state('draft'); return false; }
        pending={snapshot:JSON.stringify(latest),method:current?'PUT':'POST',payload:{...latest,title:latest.title.trim()||'Untitled entry',id:targetId,mutation_id:uuid(),...(current?{updated:current.updated}:{})}};
        persist();
      }
      state('saving');
      try {
        const result=await request(pending.method==='POST'?'/api/entries':`/api/entries/${targetId}`,{method:pending.method,body:JSON.stringify(pending.payload)});
        current=result;saved=pending.snapshot;pending=null;conflict=false;persist();
        // UI refresh failures must not turn an acknowledged save into a failed save.
        try { onSaved(result); } catch {}
      } catch(error) {
        conflict=error.status===409 || error.status===404;
        const invalid=error.status>=400 && error.status<500 && !conflict && error.status!==408 && error.status!==429;
        if(invalid)pending=null;
        persist();state(conflict?'conflict':'error',error);
        if(!conflict&&!invalid)schedule(retryDelay);
        throw error;
      }
    }
    state('saved');return true;
  }
  function flush() {
    timers.clearTimeout(timer);
    if(stopped)return Promise.resolve(false);
    if(inflight)return inflight;
    inflight=run().finally(()=>{inflight=null;});
    return inflight;
  }
  return {
    update(value) { latest=structuredClone(value);if(!current&&!pending)saved='';persist();state(conflict?'conflict':'pending');schedule(delay); },
    flush,
    get dirty(){return dirty();},get recoverable(){return recoverable;},get entry(){return current;},
    dispose(){stopped=true;timers.clearTimeout(timer);},
    discard(){stopped=true;timers.clearTimeout(timer);store.remove(draftKey);},
    resume(){persist();state('pending');schedule(delay);}
  };
}
