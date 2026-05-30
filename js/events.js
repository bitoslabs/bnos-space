// ============================================
// js/events.js — Event Display, Timeline, Query, Filter Chips, Saved Queries
// ============================================

// ── Event Cards ──
function addEventCard(evt) {
  const list=document.getElementById('eventsList');
  if(events.length===1) list.innerHTML='';
  const card=document.createElement('div'); card.className='event-card'; card.onclick=()=>showEventDetail(evt);
  const tagsHtml=(evt.tags||[]).slice(0,5).map(t=>`<span class="ev-tag">${escHtml(t[0])}: ${escHtml(truncate(t[1],16))}</span>`).join('');
  card.innerHTML=`<div class="ev-header"><span class="ev-kind ${getKindClass(evt.kind)}">${evt.kind} ${escHtml(getKindName(evt.kind))}</span><span class="ev-pubkey" title="${escHtml(evt.pubkey)}">${escHtml(npubEncode(evt.pubkey).slice(0,20))}...</span><span class="ev-time">${formatTime(evt.created_at)}</span></div><div class="ev-content">${escHtml(truncate(evt.content,200))}</div>${tagsHtml?`<div class="ev-tags">${tagsHtml}</div>`:''}`;
  list.appendChild(card); list.scrollTop=list.scrollHeight;
}

function showEventDetail(evt) {
  const detail=document.getElementById('eventDetail');
  const tagsFmt=(evt.tags||[]).map(t=>`  [${t.map(x=>`"${x}"`).join(', ')}]`).join('\n');
  detail.innerHTML=`<div class="detail-close-bar" style="display:none;position:sticky;top:0;background:var(--bg2);padding:8px 14px;border-bottom:1px solid var(--border);z-index:5;"><button onclick="closeMobileDetail()" style="border:none;background:none;color:var(--text);font-size:14px;cursor:pointer;">← Back to events</button></div><div class="detail-content"><h3>📋 Kind ${evt.kind} (${escHtml(getKindName(evt.kind))})</h3><div class="detail-field"><div class="df-label">Event ID</div><div class="df-value" onclick="copyText(this,'${escHtml(evt.id)}')">${escHtml(evt.id)}<span style="color:var(--text2);font-size:10px;margin-left:8px;">note: ${escHtml(noteEncode(evt.id))}</span></div></div><div class="detail-field"><div class="df-label">Pubkey (Author)</div><div class="df-value" onclick="copyText(this,'${escHtml(evt.pubkey)}')">${escHtml(evt.pubkey)}<span style="color:var(--text2);font-size:10px;margin-left:8px;">npub: ${escHtml(npubEncode(evt.pubkey))}</span></div></div><div class="detail-field"><div class="df-label">Created At</div><div class="df-value">${evt.created_at} (${formatTime(evt.created_at)})</div></div><div class="detail-field"><div class="df-label">Signature</div><div class="df-value" onclick="copyText(this,'${escHtml(evt.sig)}')" style="font-size:10px;">${escHtml(evt.sig)}</div></div><div class="detail-field"><div class="df-label">Tags (${(evt.tags||[]).length})</div><div class="df-value" style="white-space:pre;font-size:11px;">${escHtml(tagsFmt)}</div></div><div class="detail-field"><div class="df-label">Content</div><div class="df-value" onclick="copyText(this)" style="white-space:pre-wrap;max-height:300px;overflow-y:auto;">${escHtml(evt.content)}</div></div><div class="detail-field" style="margin-top:12px;"><div class="df-label">Raw JSON</div><pre class="raw-json">${escHtml(JSON.stringify(evt,null,2))}</pre></div><div class="btn-row" style="margin-top:8px;"><button onclick="copyJson()">📋 Copy</button><button onclick="queryReplies()">💬 Replies</button><button onclick="queryReactions()">👍 Reactions</button><button onclick="queryAuthorEvents()">👤 Author</button><button class="danger" onclick="deleteEvent()">🗑 Delete</button></div></div>`;
  window._currentEvent=evt;
  if(window.innerWidth<=768){
    document.getElementById('eventsList').classList.add('mobile-hide');
    detail.classList.add('mobile-show');
    detail.querySelector('.detail-close-bar').style.display='block';
    updateMobileNav('events');
  }
}

function closeMobileDetail() {
  document.getElementById('eventsList').classList.remove('mobile-hide');
  const dp=document.getElementById('eventDetail'); dp.classList.remove('mobile-show');
  const cb=dp.querySelector('.detail-close-bar'); if(cb)cb.style.display='none';
}

function copyJson() { if(window._currentEvent) clipboardWrite(JSON.stringify(window._currentEvent,null,2)); }
function queryReplies() { if(!window._currentEvent)return; document.getElementById('qEtag').value=window._currentEvent.id; document.getElementById('qKinds').value='1,7'; document.getElementById('qLimit').value='50'; runQuery(); switchTab('query'); }
function queryReactions() { if(!window._currentEvent)return; document.getElementById('qEtag').value=window._currentEvent.id; document.getElementById('qKinds').value='7'; document.getElementById('qLimit').value='50'; runQuery(); switchTab('query'); }
function queryAuthorEvents() { if(!window._currentEvent)return; document.getElementById('qAuthors').value=window._currentEvent.pubkey; document.getElementById('qKinds').value=''; document.getElementById('qLimit').value='100'; runQuery(); switchTab('query'); }
function deleteEvent() { if(!window._currentEvent)return; document.getElementById('pubKind').value='5'; document.getElementById('pubContent').value='delete'; document.getElementById('pubTags').value=JSON.stringify([['e',window._currentEvent.id]]); switchTab('publish'); }

// ── Filter Chips ──
function updateFilterChips() {
  const kinds={}; events.forEach(e=>{kinds[e.kind]=(kinds[e.kind]||0)+1;});
  const c=document.getElementById('filterChips'); c.innerHTML='';
  Object.entries(kinds).sort((a,b)=>b[1]-a[1]).forEach(([kind,count])=>{
    const chip=document.createElement('span'); chip.className='chip';
    chip.textContent=`${kind} ${getKindName(parseInt(kind))} (${count})`;
    chip.onclick=()=>{document.getElementById('qKinds').value=kind;document.getElementById('qLimit').value='500';runQuery();};
    c.appendChild(chip);
  });
}

// ── Query Builder ──
function buildFilter() {
  const filter={};
  const defs=[
    {id:'qKinds',key:'kinds',parse:v=>v.split(',').map(k=>parseInt(k.trim())).filter(k=>!isNaN(k))},
    {id:'qAuthors',key:'authors',parse:v=>v.split(',').map(a=>a.trim())},
    {id:'qDtag',key:'#d',parse:v=>v.split(',').map(d=>d.trim())},
    {id:'qEtag',key:'#e',parse:v=>v.split(',').map(e=>e.trim())},
    {id:'qPtag',key:'#p',parse:v=>v.split(',').map(p=>p.trim())},
    {id:'qSince',key:'since',parse:v=>parseInt(v)},
    {id:'qUntil',key:'until',parse:v=>parseInt(v)},
    {id:'qLimit',key:'limit',parse:v=>parseInt(v)},
    {id:'qSearch',key:'search',parse:v=>v},
  ];
  defs.forEach(({id,key,parse})=>{const val=document.getElementById(id).value.trim();if(val)filter[key]=parse(val);});
  return filter;
}

function runQuery(customFilter) {
  if(!pool.getByMode('read').length) return alert('Connect at least one read relay');
  const filter=customFilter||buildFilter();
  subCounter++; activeSubId='sub_'+subCounter;
  document.getElementById('currentSubId').textContent=activeSubId;
  events=[]; pool._seenEvents.clear();
  document.getElementById('eventsList').innerHTML='';
  document.getElementById('eventCount').textContent='0';
  document.getElementById('eventsInfo').textContent='';
  queryStartTime=Date.now();
  const msg=JSON.stringify(['REQ',activeSubId,filter]);
  const count=pool.broadcast(msg,'read');
  wsLogGeneric(null,'out',`REQ → ${count} relay(s): ${msg.slice(0,300)}`);
  document.getElementById('eventsInfo').textContent=`Querying ${count} relay(s): ${JSON.stringify(filter).slice(0,200)}`;
  document.getElementById('queryRelayCount').textContent=count;
  saveQueryFilters(); updateLiveModeUI();
}

function runQueryAllKinds() {
  const all=[0,1,3,4,5,7,30078,30079,30080,30100,30101,30102,30103,30104,30105,30106,30200,30201,30202,30203,30204,30205,30206,30207,30300,30301,30310,30311,30313,30400,30401,30500,30501,30503,30591,30600,30700,30701,30702,30703,30800,30801,30802,30803,30950,30951,30952,30955,31100,31102,31109];
  customKinds.forEach(ck=>{if(!all.includes(ck.kind))all.push(ck.kind);});
  document.getElementById('qKinds').value=all.join(','); document.getElementById('qLimit').value='500'; runQuery();
}

function quickQuery(kind) { document.getElementById('qKinds').value=kind; document.getElementById('qLimit').value='100'; runQuery(); }

function stopSubscription() {
  if(!activeSubId)return;
  pool.broadcast(JSON.stringify(['CLOSE',activeSubId]),'read');
  wsLogGeneric(null,'out',`CLOSE ${activeSubId}`);
  document.getElementById('currentSubId').textContent='—';
  liveMode=false; updateLiveModeUI();
}

function clearEvents() {
  events=[];
  document.getElementById('eventsList').innerHTML='<div class="detail-empty">No events</div>';
  document.getElementById('eventDetail').innerHTML='<div class="detail-empty">Click an event to view details</div>';
  document.getElementById('eventCount').textContent='0';
  document.getElementById('eventsInfo').textContent='';
  document.getElementById('filterChips').innerHTML='';
}

function exportEvents() {
  if(!events.length)return alert('No events');
  const blob=new Blob([JSON.stringify(events,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);const a=document.createElement('a');
  a.href=url;a.download=`nostr-events-${Date.now()}.json`;a.click();URL.revokeObjectURL(url);
}

// ── Live Mode ──
function toggleLiveMode() { liveMode=!liveMode; updateLiveModeUI(); }
function updateLiveModeUI() { const b=document.getElementById('liveModeBtn'); if(b){b.textContent=liveMode?'🔴 Live ON':'📡 Live Mode';b.classList.toggle('on',liveMode);} }

// ── Saved Queries ──
function getSavedQueries() { try{const r=localStorage.getItem(STORAGE_KEY);return r?(JSON.parse(r).savedQueries||[]):[];}catch{return[];} }
function saveCurrentQuery() {
  const name=prompt('Name this query:'); if(!name)return;
  const filter=buildFilter(); const saved=getSavedQueries(); saved.push({name,filter,createdAt:Date.now()});
  try{const r=localStorage.getItem(STORAGE_KEY);const s=r?JSON.parse(r):{};s.savedQueries=saved;localStorage.setItem(STORAGE_KEY,JSON.stringify(s));}catch{}
  renderSavedQueries();
}
function deleteSavedQuery(i) {
  const saved=getSavedQueries(); saved.splice(i,1);
  try{const r=localStorage.getItem(STORAGE_KEY);const s=r?JSON.parse(r):{};s.savedQueries=saved;localStorage.setItem(STORAGE_KEY,JSON.stringify(s));}catch{}
  renderSavedQueries();
}
function loadSavedQuery(i) {
  const q=getSavedQueries()[i]; if(!q)return;
  const fm={kinds:'qKinds',authors:'qAuthors','#d':'qDtag','#e':'qEtag','#p':'qPtag',since:'qSince',until:'qUntil',limit:'qLimit',search:'qSearch'};
  Object.values(fm).forEach(id=>{document.getElementById(id).value='';});
  Object.entries(q.filter).forEach(([k,v])=>{const id=fm[k];if(id)document.getElementById(id).value=Array.isArray(v)?v.join(','):v;});
  runQuery(q.filter);
}
function renderSavedQueries() {
  const c=document.getElementById('savedQueriesList'); if(!c)return;
  const saved=getSavedQueries();
  if(!saved.length){c.innerHTML='<div style="color:var(--text2);font-size:11px;padding:4px 0;">No saved queries yet</div>';return;}
  c.innerHTML=saved.map((q,i)=>`<div class="saved-query-row"><span class="sq-name" onclick="loadSavedQuery(${i})">${escHtml(q.name)}</span><span class="sq-preview">${escHtml(JSON.stringify(q.filter).slice(0,80))}</span><button class="kind-action-btn" onclick="event.stopPropagation();deleteSavedQuery(${i})">🗑</button></div>`).join('');
}

// ── Timeline ──
function startTimeline() {
  if(!pool.getByMode('read').length) return;
  if(timelineLiveSub) pool.broadcast(JSON.stringify(['CLOSE',timelineLiveSub]),'read');
  subCounter++; timelineLiveSub='timeline_'+subCounter; timelineEvents=[];
  const filter={since:Math.floor(Date.now()/1000)-3600,limit:100};
  pool.broadcast(JSON.stringify(['REQ',timelineLiveSub,filter]),'read');
  pool._onEvent=onTimelineEvent;
  document.getElementById('timelineStatus').textContent='🔴 Live';
  document.getElementById('timelineStatus').className='live';
  renderTimeline();
}
function stopTimeline() {
  if(timelineLiveSub){pool.broadcast(JSON.stringify(['CLOSE',timelineLiveSub]),'read');timelineLiveSub=null;}
  pool._onEvent=null;
  const el=document.getElementById('timelineStatus'); if(el){el.textContent='⏸ Paused';el.className='paused';}
}
function onTimelineEvent(evt,fromUrl) {
  if(timelineEvents.find(e=>e.id===evt.id))return;
  timelineEvents.unshift({...evt,_relay:fromUrl,_received:Date.now()});
  if(timelineEvents.length>TIMELINE_MAX) timelineEvents=timelineEvents.slice(0,TIMELINE_MAX);
  renderTimeline(); updateTimelineBadge();
}
function updateTimelineBadge() {
  const t=document.querySelector('.tab[data-tab="timeline"]');
  if(t) t.textContent=`🕐 Timeline${timelineEvents.length>0?' ('+timelineEvents.length+')':''}`;
}
function renderTimeline() {
  const c=document.getElementById('timelineFeed'); if(!c)return;
  if(!timelineEvents.length){c.innerHTML='<div class="timeline-empty">No events yet. Click "Start Live" to see real-time activity.</div>';return;}
  c.innerHTML=timelineEvents.map(evt=>{
    const g=getKindGroup(evt.kind); const ago=timeAgo(evt.created_at);
    const rel=evt._relay?getRelayLabel(evt._relay):'';
    let preview='';
    try{const p=JSON.parse(evt.content);if(typeof p==='object')preview=Object.keys(p).slice(0,3).map(k=>`<span class="tl-field">${escHtml(k)}: ${escHtml(truncate(String(p[k]),20))}</span>`).join(' ');}catch{preview=`<span class="tl-text">${escHtml(truncate(evt.content,100))}</span>`;}
    const dtag=(evt.tags||[]).find(t=>t[0]==='d')?.[1];
    return `<div class="tl-card" onclick="showTimelineDetail('${escHtml(evt.id)}')" style="border-left:3px solid ${g.color};"><div class="tl-header"><span class="tl-icon">${g.icon}</span><span class="tl-kind" style="color:${g.color};">${evt.kind} ${escHtml(getKindName(evt.kind))}</span>${dtag?`<span class="tl-dtag">#${escHtml(truncate(dtag,12))}</span>`:''}<span class="tl-time">${ago}</span><span class="tl-relay">${escHtml(rel)}</span></div><div class="tl-content">${preview}</div><div class="tl-footer"><span class="tl-pubkey">${evt.pubkey.slice(0,8)}...</span>${(evt.tags||[]).length>0?`<span class="tl-tags">${(evt.tags||[]).length} tags</span>`:''}</div></div>`;
  }).join('');
}
function showTimelineDetail(id) { const evt=timelineEvents.find(e=>e.id===id)||events.find(e=>e.id===id); if(evt)showEventDetail(evt); switchTab('query'); }
function clearTimeline() { timelineEvents=[]; renderTimeline(); updateTimelineBadge(); }

// ── Custom Kind Manager ──
function renderCustomKinds() {
  const sec=document.getElementById('customKindsSection'); const list=document.getElementById('customKindsList');
  if(!customKinds.length){sec.style.display='none';return;} sec.style.display='';
  list.innerHTML=customKinds.map((ck,i)=>`<div class="sidebar-item" onclick="quickQuery(${ck.kind})"><span class="kind-badge">${ck.kind}</span><span class="kind-name">${escHtml(ck.name)}</span><span class="kind-actions"><button class="kind-action-btn" onclick="event.stopPropagation();editCustomKind(${i})">✏️</button><button class="kind-action-btn" onclick="event.stopPropagation();deleteCustomKind(${i})">🗑</button></span></div>`).join('');
}
function openAddCustomKind(){document.getElementById('ckKind').value='';document.getElementById('ckName').value='';document.getElementById('ckEmoji').value='🔧';document.getElementById('ckCategory').value='';document.getElementById('ckEditIndex').value='-1';document.getElementById('customKindModal').classList.add('show');}
function closeCustomKindModal(){document.getElementById('customKindModal').classList.remove('show');}
function editCustomKind(i){const ck=customKinds[i];if(!ck)return;document.getElementById('ckKind').value=ck.kind;document.getElementById('ckName').value=ck.name;document.getElementById('ckEmoji').value=ck.emoji||'';document.getElementById('ckCategory').value=ck.category||'';document.getElementById('ckEditIndex').value=i;document.getElementById('customKindModal').classList.add('show');}
function deleteCustomKind(i){const ck=customKinds[i];if(!ck||!confirm(`Delete kind ${ck.kind} "${ck.name}"?`))return;customKinds.splice(i,1);saveSettings();renderCustomKinds();}
function saveCustomKind(){const kind=parseInt(document.getElementById('ckKind').value);const name=document.getElementById('ckName').value.trim();const emoji=document.getElementById('ckEmoji').value.trim()||'🔧';const cat=document.getElementById('ckCategory').value.trim()||'Custom';const ei=parseInt(document.getElementById('ckEditIndex').value);if(isNaN(kind)||kind<0)return alert('Enter a valid kind number');if(!name)return alert('Enter a name');if(ei>=0)customKinds[ei]={kind,name,emoji,category:cat};else{if(customKinds.some(c=>c.kind===kind))return alert(`Kind ${kind} already exists.`);customKinds.push({kind,name,emoji,category:cat});}KIND_NAMES[kind]=name;saveSettings();renderCustomKinds();closeCustomKindModal();}
function importExportKinds(){document.getElementById('ieExport').value=JSON.stringify(customKinds,null,2);document.getElementById('ieImport').value='';document.getElementById('importExportModal').classList.add('show');}
function closeImportExportModal(){document.getElementById('importExportModal').classList.remove('show');}
function importKinds(){const raw=document.getElementById('ieImport').value.trim();if(!raw)return alert('Paste JSON first');try{const imp=JSON.parse(raw);if(!Array.isArray(imp))throw new Error('Must be array');let added=0;imp.forEach(ck=>{if(typeof ck.kind==='number'&&ck.name&&!customKinds.some(c=>c.kind===ck.kind)){customKinds.push({kind:ck.kind,name:ck.name,emoji:ck.emoji||'🔧',category:ck.category||'Imported'});KIND_NAMES[ck.kind]=ck.name;added++;}});saveSettings();renderCustomKinds();closeImportExportModal();alert(`Imported ${added} kinds`);}catch(e){alert('Invalid JSON: '+e.message);}}
