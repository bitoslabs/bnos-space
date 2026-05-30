// ============================================
// js/app.js — Publish, UI (tabs, sidebar, theme, mobile), Init
// ============================================

// ── Publish Event ──
async function publishEvent() {
  const ok = await loadCrypto();
  if (!ok) return alert('Crypto library could not load.\nCheck internet connection and refresh.');
  if(!pool.getByMode('write').length) return alert('Connect at least one write relay');

  const kind=parseInt(document.getElementById('pubKind').value);
  const content=document.getElementById('pubContent').value;
  const tagsRaw=document.getElementById('pubTags').value.trim();
  let tags=[]; if(tagsRaw){try{tags=JSON.parse(tagsRaw);}catch{return alert('Invalid tags JSON');}}

  const created_at=parseInt(document.getElementById('pubCreated').value)||Math.floor(Date.now()/1000);

  // NIP-07 path
  if(hasNip07()){
    try{const unsigned={kind,content,tags,created_at};const signed=await nip07SignEvent(unsigned);if(signed){const count=pool.broadcast(JSON.stringify(['EVENT',signed]),'write');switchTab('raw');alert(`Published via NIP-07 to ${count} relay(s)! ID: ${signed.id}`);return;}}catch(e){console.warn('NIP-07 failed, falling back',e);}
  }

  // Keychain / manual key
  let privkey=getActivePrivkey();
  if(!privkey){
    privkey=document.getElementById('pubPrivkey').value.trim();
    if(!privkey){privkey=window._randomPrivkey;if(!privkey)return alert('Login with a key first, or generate one');}
    if(privkey.startsWith('nsec1')){privkey=decodeNsec(privkey);if(!privkey)return alert('Invalid nsec');}
  }

  const pubkey=bytesToHex(schnorr.getPublicKey(privkey));
  const signedEvt=await signEvent({kind,content,tags,pubkey,created_at},privkey);
  const count=pool.broadcast(JSON.stringify(['EVENT',signedEvt]),'write');
  switchTab('raw');
  alert(`Published to ${count} relay(s)! ID: ${signedEvt.id}`);
}

function genRandomKey() {
  loadCrypto().then(ok=>{
    if(!ok) return alert('Crypto not loaded — check internet & refresh');
    const hex=bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
    const pubkey=bytesToHex(schnorr.getPublicKey(hex));
    window._randomPrivkey=hex;
    document.getElementById('pubPrivkey').value=nsecEncode(hex);
    document.getElementById('keyInfo').innerHTML=`🔑 <b>nsec:</b> ${nsecEncode(hex)}<br>📬 <b>npub:</b> ${npubEncode(pubkey)}<br><span style="color:var(--text2);font-size:10px;">Hex: ${pubkey}</span>`;
  });
}

function genTestNote() {
  document.getElementById('pubKind').value='1';
  document.getElementById('pubContent').value=`Hello from BnOS Console! ${new Date().toISOString()} ⚡`;
  document.getElementById('pubTags').value='[]';
  if(!document.getElementById('pubPrivkey').value&&!hasNip07()) genRandomKey();
}

// ── Raw WS ──
function sendRawWs() {
  const input=document.getElementById('wsInput').value.trim(); if(!input)return;
  if(!pool.getByMode('read').length) return alert('No connected read relays');
  try{JSON.parse(input);const count=pool.broadcast(input,'read');wsLogGeneric(null,'out',`Sent to ${count} relay(s): ${input.slice(0,200)}`);}catch(e){alert('Invalid JSON: '+e.message);}
}
function clearWsLog(){document.getElementById('wsLog').innerHTML='';}

function wsTemplate(type) {
  const input=document.getElementById('wsInput'); subCounter++; const sid='tpl_'+subCounter;
  const t={reqall:['REQ',sid,{kinds:[0],limit:20}],reqnotes:['REQ',sid,{kinds:[1],limit:50}],reqbnos:['REQ',sid,{kinds:[30100],limit:50}],reqorders:['REQ',sid,{kinds:[30200],limit:50}],count:['COUNT',sid,{kinds:[0,1]}],close:['CLOSE',activeSubId||'sub_1'],event:['EVENT',{kind:1,content:'Test from BnOS ⚡',tags:[],pubkey:'0'.repeat(64),created_at:Math.floor(Date.now()/1000),id:'...',sig:'...'}]};
  if(t[type]) input.value=JSON.stringify(t[type]); switchTab('raw');
}

// ── Tab Switching ──
function switchTab(tabName) {
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  document.querySelectorAll('.panel').forEach(p=>p.classList.remove('active'));
  const tabEl=document.querySelector(`.tab[data-tab="${tabName}"]`); if(tabEl)tabEl.classList.add('active');
  const panel=document.getElementById(`panel-${tabName}`); if(panel)panel.classList.add('active');
  if(tabName==='relays')updateRelayManagerList();
  updateMobileNav(tabName);
}

// ── Sidebar Filter ──
function initSidebarFilter() {
  const input=document.getElementById('sidebarFilter'); if(!input)return;
  input.addEventListener('input',()=>{
    const q=input.value.trim().toLowerCase();
    const items=document.querySelectorAll('#sidebarKinds .sidebar-item');
    const sections=document.querySelectorAll('#sidebarKinds .sidebar-section');
    if(!q){items.forEach(i=>i.classList.remove('hidden-by-filter'));sections.forEach(s=>s.classList.remove('hidden-by-filter'));return;}
    items.forEach(item=>{const badge=item.querySelector('.kind-badge')?.textContent||'';const name=item.querySelector('.kind-name')?.textContent?.toLowerCase()||'';item.classList.toggle('hidden-by-filter',!badge.includes(q)&&!name.includes(q));});
    sections.forEach(sec=>{sec.classList.toggle('hidden-by-filter',sec.querySelectorAll('.sidebar-item:not(.hidden-by-filter)').length===0);});
  });
}

function getColorTheme(){return document.documentElement.getAttribute('data-theme')||'nostr';}
function setColorTheme(t){document.documentElement.setAttribute('data-theme',t);localStorage.setItem('bnos_console_color',t);document.querySelectorAll('.theme-dot').forEach(d=>{d.classList.toggle('active',d.dataset.theme===t);});}

// ── Theme (dark/light) ──
function getTheme(){return document.body.getAttribute('data-theme')||'dark';}
function setTheme(t){document.body.setAttribute('data-theme',t);const b=document.getElementById('themeToggle');if(b)b.textContent=t==='light'?'☀️':'🌙';try{const r=localStorage.getItem(STORAGE_KEY);const s=r?JSON.parse(r):{};s.theme=t;localStorage.setItem(STORAGE_KEY,JSON.stringify(s));}catch{}}
function toggleTheme(){setTheme(getTheme()==='dark'?'light':'dark');}
function restoreTheme(){try{const r=localStorage.getItem(STORAGE_KEY);if(r){const s=JSON.parse(r);if(s.theme)setTheme(s.theme);}}catch{}}

// ── Sidebar Toggle ──
function toggleSidebar(){document.getElementById('sidebarKinds').classList.toggle('open');document.getElementById('sidebarOverlay').classList.toggle('show');}
function closeSidebarOnMobile(){if(window.innerWidth<=768){document.getElementById('sidebarKinds').classList.remove('open');document.getElementById('sidebarOverlay').classList.remove('show');}}

// ── Mobile UX ──
function mobileTab(tabName) {
  if(tabName==='events'){closeMobileDetail();document.querySelectorAll('.panel').forEach(p=>p.classList.remove('active'));document.getElementById('eventsList').classList.remove('mobile-hide');document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));updateMobileNav('events');return;}
  closeMobileDetail(); switchTab(tabName);
}
function updateMobileNav(activeTab){document.querySelectorAll('#mobileNav button').forEach(b=>{b.classList.toggle('active',b.getAttribute('data-mtab')===activeTab);});}

function toggleQueryForm() {
  const row=document.getElementById('queryFormRow'); const btn=document.getElementById('queryToggleBtn');
  row.classList.toggle('expanded');
  const isOpen=row.classList.contains('expanded');
  row.dataset.userExpanded=isOpen?'1':'';
  btn.textContent=isOpen?'▲ Hide Filters':'▼ Show Filters';
}

function handleResize() {
  const btn=document.getElementById('queryToggleBtn'); const row=document.getElementById('queryFormRow');
  const isMobile=window.innerWidth<=768;
  if(isMobile){
    btn.style.display='flex';
    if(!row.dataset.userExpanded){row.classList.remove('expanded');btn.textContent='▼ Show Filters';}
    closeMobileDetail();
  } else {
    btn.style.display='none'; row.classList.add('expanded'); row.dataset.userExpanded='';
    document.getElementById('eventsList').classList.remove('mobile-hide');
    document.getElementById('eventDetail').classList.remove('mobile-show');
    const cb=document.getElementById('eventDetail').querySelector('.detail-close-bar'); if(cb)cb.style.display='none';
  }
}
window.addEventListener('resize',handleResize);

// ── NIP-07 Status ──
function updateNip07Status() {
  const el=document.getElementById('nip07Status'); if(!el)return;
  if(hasNip07()){el.innerHTML='<span style="color:var(--green);">✅ NIP-07 detected</span>';nip07GetPubkey().then(pk=>{if(pk)el.innerHTML+=` <span style="color:var(--text2);font-size:10px;">${npubEncode(pk).slice(0,20)}...</span>`;});}
  else{el.innerHTML='<span style="color:var(--text2);">No NIP-07 extension</span>';}
}

// ── Keyboard Shortcuts ──
document.addEventListener('keydown',(e)=>{
  if(e.ctrlKey&&e.key==='Enter'){const id=document.querySelector('.panel.active')?.id;if(id==='panel-query')runQuery();if(id==='panel-raw')sendRawWs();if(id==='panel-publish')publishEvent();}
  if(e.key==='Escape'){closeCustomKindModal();closeImportExportModal();closeKeychainModal();}
});
Object.values(QUERY_FIELDS).forEach(id=>{const el=document.getElementById(id);if(el)el.addEventListener('change',saveQueryFilters);});
document.addEventListener('click',(e)=>{if(e.target.closest('.sidebar-item'))closeSidebarOnMobile();});

// ── Crypto Preload Status ──
function showCryptoStatus() {
  const el=document.getElementById('cryptoStatus'); if(!el)return;
  el.innerHTML='<span style="color:var(--text2);">⏳ Loading crypto...</span>';
  loadCrypto().then(ok=>{
    if(ok) el.innerHTML='<span style="color:var(--green);">✅ Crypto ready</span>';
    else el.innerHTML='<span style="color:var(--red);">❌ Crypto failed — check internet</span>';
    setTimeout(()=>{el.innerHTML='';},4000);
  });
}

// ============================================
// INIT
// ============================================
loadSettings();
restoreTheme();
pool = new RelayPool();
customKinds.forEach(ck=>{KIND_NAMES[ck.kind]=ck.name;});
loadKeychain();
updateIdentityBar();
renderCustomKinds();
updateRelayStatusBar();
updateRelayManagerList();
initSidebarFilter();
updateNip07Status();
renderSavedQueries();
renderTimeline();
updateTimelineBadge();
relaySettings.forEach(r=>pool.connect(r.url));
handleResize();
showCryptoStatus();
