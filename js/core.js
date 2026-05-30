// ============================================
// js/core.js — State, Constants, Utils, Crypto, Keychain
// ============================================

// ── Constants ──
const STORAGE_KEY = '***';
const KEYCHAIN_KEY = '***';
const KEYCHAIN_SALT = new TextEncoder().encode('bnos-keychain-salt-v1');
const RELAY_COLORS = ['#a855f7','#3b82f6','#22c55e','#f97316','#ef4444','#ec4899','#06b6d4','#eab308'];
const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const TIMELINE_MAX = 200;

const DEFAULT_RELAYS = [
  { url: 'wss://relay.damus.io',    label: 'Damus', read: true, write: true, color: '#3b82f6' },
  { url: 'wss://nos.lol',           label: 'nos.lol', read: true, write: true, color: '#22c55e' },
];

// ── Global State ──
let relaySettings  = [];
let customKinds    = [];
let events         = [];
let subCounter     = 0;
let activeSubId    = null;
let queryStartTime = 0;
let relayInfoCache = {};
let liveMode       = false;
let pool;

let secp256k1 = null;
let schnorr   = null;

let keychain = { keys: [], activeIndex: -1, unlocked: false, _rawKey: null };
let timelineEvents = [];
let timelineLiveSub = null;

const QUERY_FIELDS = {
  kinds: 'qKinds', authors: 'qAuthors', dtag: 'qDtag',
  etag: 'qEtag', ptag: 'qPtag', since: 'qSince',
  until: 'qUntil', limit: 'qLimit', search: 'qSearch',
};

// ── Kind Registry ──
const KIND_NAMES = {
  0:'Profile', 1:'Text Note', 3:'Contacts', 4:'DM', 5:'Deletion', 7:'Reaction',
  9:'Group Chat', 40:'Channel Create', 42:'Channel Msg',
  1050:'POS Alert', 22242:'Auth', 9735:'Zap',
  30078:'Store Settings', 30079:'Store Profile', 30080:'Table',
  30100:'Product', 30101:'Category', 30102:'Unit', 30103:'Modifier',
  30104:'Ingredient', 30105:'Recipe', 30106:'Recipe Cat',
  30200:'Order', 30201:'Payment', 30202:'Refund', 30203:'Invoice', 30204:'Invoice Pay',
  30205:'Contract', 30206:'Rental Asset', 30207:'Rental Booking',
  30300:'Customer', 30301:'Loyalty Pts', 30310:'Coupon', 30311:'Membership', 30313:'Promo',
  30400:'Stock Adj', 30401:'Inv Count',
  30500:'Staff', 30501:'POS Session', 30503:'Company Idx', 30591:'Workspaces',
  30600:'Branch',
  30700:'Supplier', 30701:'Branch Stock', 30702:'PO', 30703:'Transfer',
  30800:'Account', 30801:'Journal', 30802:'Expense', 30803:'Fin Report',
  30850:'Help Article',
  30900:'Chat Channel', 30950:'Marketplace', 30951:'Mkt Product',
  30952:'Mkt Order', 30955:'Review',
  31100:'Project', 31102:'Issue', 31109:'Wiki Page',
};

const KIND_GROUPS = {
  profile:   { kinds:[0], color:'#3b82f6', icon:'👤', label:'Profile' },
  notes:     { kinds:[1], color:'#22c55e', icon:'📝', label:'Notes' },
  contacts:  { kinds:[3], color:'#8b5cf6', icon:'👥', label:'Contacts' },
  dm:        { kinds:[4], color:'#ec4899', icon:'✉️', label:'DMs' },
  delete:    { kinds:[5], color:'#ef4444', icon:'🗑', label:'Deletions' },
  reaction:  { kinds:[7], color:'#f59e0b', icon:'👍', label:'Reactions' },
  store:     { kinds:[30078,30079,30080], color:'#a855f7', icon:'🏪', label:'Store' },
  catalog:   { kinds:[30100,30101,30102,30103,30104,30105,30106], color:'#06b6d4', icon:'🛍', label:'Catalog' },
  orders:    { kinds:[30200,30201,30202,30203,30204], color:'#f97316', icon:'🧾', label:'Orders' },
  crm:       { kinds:[30300,30301,30310,30311,30313], color:'#3b82f6', icon:'👥', label:'CRM' },
  inventory: { kinds:[30400,30401], color:'#22c55e', icon:'📦', label:'Inventory' },
  staff:     { kinds:[30500,30501,30503,30591], color:'#8b5cf6', icon:'👷', label:'Staff' },
  supply:    { kinds:[30700,30701,30702,30703], color:'#f59e0b', icon:'🚚', label:'Supply' },
  account:   { kinds:[30800,30801,30802,30803], color:'#ef4444', icon:'💰', label:'Accounting' },
  market:    { kinds:[30950,30951,30952,30955], color:'#ec4899', icon:'🏪', label:'Marketplace' },
  project:   { kinds:[31100,31102,31109], color:'#06b6d4', icon:'📋', label:'Projects' },
};

// ── Utility Functions ──
function escHtml(s) {
  if (!s) return '';
  const m = { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' };
  return s.replace(/[&<>"]/g, c => m[c]);
}
function formatTime(ts) { return ts ? new Date(ts*1000).toLocaleString() : ''; }
function truncate(s, len) { if (!s) return ''; s = String(s); return s.length > len ? s.slice(0,len)+'...' : s; }
function getKindName(k) { return KIND_NAMES[k] || `Kind ${k}`; }
function getKindClass(k) { return ({0:'ev-k0',1:'ev-k1',3:'ev-k3',4:'ev-k4',5:'ev-k5',7:'ev-k7'})[k] || 'ev-kCustom'; }
function getRelayLabel(url) { const r = relaySettings.find(s => s.url === url); return r ? (r.label||url) : url; }
function hexToBytes(hex) { const b = new Uint8Array(hex.length/2); for (let i=0;i<hex.length;i+=2) b[i/2]=parseInt(hex.substr(i,2),16); return b; }
function bytesToHex(b) { return Array.from(b).map(x => x.toString(16).padStart(2,'0')).join(''); }
function timeAgo(ts) { const d=Math.floor(Date.now()/1000)-ts; if(d<60)return d+'s ago'; if(d<3600)return Math.floor(d/60)+'m ago'; if(d<86400)return Math.floor(d/3600)+'h ago'; return Math.floor(d/86400)+'d ago'; }
function getKindGroup(kind) { for (const [k,g] of Object.entries(KIND_GROUPS)) if (g.kinds.includes(kind)) return {key:k,...g}; return {key:'other',color:'#6b7280',icon:'📄',label:'Other'}; }

// ── Clipboard ──
function clipboardWrite(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
  const ta = document.createElement('textarea'); ta.value = text;
  ta.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0;';
  document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); } catch(e) {}
  document.body.removeChild(ta);
}
function copyText(el, text) { clipboardWrite(text||el.textContent); el.classList.add('copied'); setTimeout(()=>el.classList.remove('copied'),1000); }

// ── Bech32 ──
function bech32Polymod(values) { const G=[0x3b6a57b2,0x26508e6d,0x1ea119fa,0x3d4233dd,0x2a1462b3]; let c=1; for(const v of values){const b=c>>25;c=((c&0x1ffffff)<<5)^v;for(let i=0;i<5;i++)if((b>>i)&1)c^=G[i];} return c; }
function bech32HrpExpand(hrp) { const r=[];for(let i=0;i<hrp.length;i++)r.push(hrp.charCodeAt(i)>>5);r.push(0);for(let i=0;i<hrp.length;i++)r.push(hrp.charCodeAt(i)&31);return r; }
function bech32CreateChecksum(hrp,data) { const v=[...bech32HrpExpand(hrp),...data,0,0,0,0,0,0];const p=bech32Polymod(v)^1;const r=[];for(let i=0;i<6;i++)r.push((p>>(5*(5-i)))&31);return r; }
function convertBits(data,from,to,pad) { let acc=0,bits=0;const r=[],max=(1<<to)-1;for(const v of data){acc=(acc<<from)|v;bits+=from;while(bits>=to){bits-=to;r.push((acc>>bits)&max);}}if(pad&&bits>0)r.push((acc<<(to-bits))&max);return r; }
function bech32Encode(hrp,hex) { const w=convertBits(hexToBytes(hex),8,5,true);return hrp+'1'+[...w,...bech32CreateChecksum(hrp,w)].map(v=>BECH32_CHARSET[v]).join(''); }
function bech32Decode(bech) { const hrp=bech.slice(0,bech.indexOf('1'));const dp=bech.slice(hrp.length+1);const d=[];for(const c of dp)d.push(BECH32_CHARSET.indexOf(c));return bytesToHex(new Uint8Array(convertBits(d.slice(0,-6),5,8,false))); }
function npubEncode(hex) { return bech32Encode('npub',hex); }
function nsecEncode(hex) { return bech32Encode('nsec',hex); }
function noteEncode(hex) { return bech32Encode('note',hex); }
function decodeNsec(nsec) { return nsec?.startsWith('nsec1') ? bech32Decode(nsec) : null; }

// ── Crypto (with retry + multi-CDN) ──
const CRYPTO_CDNS = [
  'https://esm.sh/@noble/secp256k1@2.1.0',
  'https://cdn.jsdelivr.net/npm/@noble/secp256k1@2.1.0/+esm',
];

async function sha256(msg) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(msg));
  return bytesToHex(new Uint8Array(buf));
}

async function loadCrypto() {
  if (schnorr) return true;
  for (const cdn of CRYPTO_CDNS) {
    try {
      const mod = await import(cdn);
      if (mod.schnorr) { secp256k1 = mod; schnorr = mod.schnorr; console.log(`✅ Crypto loaded from ${cdn}`); return true; }
    } catch (e) { console.warn(`CDN failed: ${cdn}`, e.message); }
  }
  console.error('❌ All crypto CDNs failed');
  return false;
}

function serializeEvent(evt) { return JSON.stringify([0,evt.pubkey,evt.created_at,evt.kind,evt.tags,evt.content]); }

async function signEvent(evt, privHex) {
  if (!schnorr) await loadCrypto();
  if (!schnorr) throw new Error('Crypto not available');
  const id = await sha256(serializeEvent(evt));
  evt.id = id;
  evt.sig = bytesToHex(schnorr.sign(id, privHex));
  return evt;
}

// ── Settings Persistence ──
function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      relaySettings = s.relays || DEFAULT_RELAYS.map(r=>({...r}));
      customKinds = s.customKinds || [];
      if (s.lastQuery) Object.entries(QUERY_FIELDS).forEach(([k,id])=>{ if(s.lastQuery[k])document.getElementById(id).value=s.lastQuery[k]; });
      return;
    }
  } catch(e) { console.warn('Load settings failed', e); }
  relaySettings = DEFAULT_RELAYS.map(r=>({...r}));
  customKinds = [];
}

function saveSettings() {
  try {
    const lq = {}; Object.entries(QUERY_FIELDS).forEach(([k,id])=>{ lq[k]=document.getElementById(id).value; });
    const raw = localStorage.getItem(STORAGE_KEY);
    const ex = raw ? JSON.parse(raw) : {};
    localStorage.setItem(STORAGE_KEY, JSON.stringify({...ex, relays:relaySettings, customKinds, lastQuery:lq}));
  } catch(e) { console.warn('Save settings failed', e); }
}
function saveQueryFilters() { saveSettings(); }

function resetToDefaults() { if(!confirm('Reset all settings to defaults?'))return; localStorage.removeItem(STORAGE_KEY); location.reload(); }

// ── NIP-07 Extension ──
function hasNip07() { return typeof window!=='undefined' && window.nostr && typeof window.nostr.getPublicKey==='function'; }
async function nip07GetPubkey() { if(!hasNip07())return null; try{return await window.nostr.getPublicKey();}catch{return null;} }
async function nip07SignEvent(event) { if(!hasNip07())return null; try{return await window.nostr.signEvent(event);}catch{return null;} }

// ── Keychain ──
function loadKeychain() {
  try { const raw=localStorage.getItem(KEYCHAIN_KEY); if(raw){const d=JSON.parse(raw);keychain.keys=d.keys||[];keychain.activeIndex=d.activeIndex??-1;} } catch { keychain.keys=[]; keychain.activeIndex=-1; }
}
function saveKeychain() {
  try { localStorage.setItem(KEYCHAIN_KEY,JSON.stringify({keys:keychain.keys.map(k=>({label:k.label,npub:k.npub,encPrivkey:k.encPrivkey,iv:k.iv,created:k.created})),activeIndex:keychain.activeIndex})); } catch {}
}

async function deriveAesKey(password, forEncrypt) {
  const km = await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveKey']);
  return crypto.subtle.deriveKey({name:'PBKDF2',salt:KEYCHAIN_SALT,iterations:100000,hash:'SHA-256'},km,{name:'AES-GCM',length:256},false,forEncrypt?['encrypt']:['decrypt']);
}

async function keychainAddKey(label, privHex, password) {
  const ok = await loadCrypto();
  if (!ok) throw new Error('Crypto library could not load. Check your internet connection and refresh.');
  const pubkey = bytesToHex(schnorr.getPublicKey(privHex));
  const npub = npubEncode(pubkey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aesKey = await deriveAesKey(password, true);
  const encrypted = await crypto.subtle.encrypt({name:'AES-GCM',iv},aesKey,hexToBytes(privHex));
  const entry = { label:label||`Key ${keychain.keys.length+1}`, npub, encPrivkey:btoa(String.fromCharCode(...new Uint8Array(encrypted))), iv:btoa(String.fromCharCode(...iv)), created:Date.now() };
  keychain.keys.push(entry);
  keychain.activeIndex = keychain.keys.length - 1;
  keychain.unlocked = true;
  keychain._rawKey = privHex;
  saveKeychain(); renderKeychain(); updateIdentityBar();
  return entry;
}

async function keychainUnlock(index, password) {
  const entry = keychain.keys[index];
  if (!entry) throw new Error('Key not found');
  try {
    const iv = Uint8Array.from(atob(entry.iv),c=>c.charCodeAt(0));
    const encData = Uint8Array.from(atob(entry.encPrivkey),c=>c.charCodeAt(0));
    const aesKey = await deriveAesKey(password, false);
    const decrypted = await crypto.subtle.decrypt({name:'AES-GCM',iv},aesKey,encData);
    keychain.activeIndex = index; keychain.unlocked = true; keychain._rawKey = bytesToHex(new Uint8Array(decrypted));
    saveKeychain(); renderKeychain(); updateIdentityBar();
    return true;
  } catch { throw new Error('Wrong password'); }
}

function keychainLock() { keychain.unlocked=false; keychain._rawKey=null; renderKeychain(); updateIdentityBar(); }

function keychainRemove(index) {
  const e=keychain.keys[index]; if(!e||!confirm(`Remove key "${e.label}"?`))return;
  keychain.keys.splice(index,1);
  if(keychain.activeIndex===index){keychain.activeIndex=-1;keychain.unlocked=false;keychain._rawKey=null;}
  else if(keychain.activeIndex>index) keychain.activeIndex--;
  saveKeychain(); renderKeychain(); updateIdentityBar();
}

function keychainSelect(index) {
  if(index===keychain.activeIndex&&keychain.unlocked) return;
  const pw=prompt(`Enter password to unlock "${keychain.keys[index].label}":`);
  if(!pw)return;
  keychainUnlock(index,pw).then(()=>pool.nip42Reauth()).catch(e=>alert(e.message));
}

function getActivePubkey() {
  if(keychain.unlocked&&keychain.activeIndex>=0){const e=keychain.keys[keychain.activeIndex];return e?.npub?bech32Decode(e.npub):null;}
  if(hasNip07()) return nip07GetPubkey();
  return null;
}
function getActivePrivkey() { return keychain.unlocked?keychain._rawKey:null; }

function updateIdentityBar() {
  const bar=document.getElementById('identityBar'); if(!bar)return;
  if(keychain.unlocked&&keychain.activeIndex>=0){
    const e=keychain.keys[keychain.activeIndex];
    bar.innerHTML=`<div class="identity-pill active" onclick="openKeychainModal()"><span class="identity-dot"></span><span class="identity-label">${escHtml(e.label)}</span><span class="identity-npub">${e.npub.slice(0,16)}...</span></div><button class="identity-lock" onclick="keychainLock()" title="Lock">🔓</button>`;
  } else if(hasNip07()){
    bar.innerHTML=`<div class="identity-pill ext" onclick="openKeychainModal()"><span class="identity-dot ext"></span><span class="identity-label">NIP-07 Extension</span></div>`;
  } else {
    bar.innerHTML=`<button class="identity-login" onclick="openKeychainModal()">🔑 Login</button>`;
  }
}

function renderKeychain() {
  const list=document.getElementById('keychainList'); if(!list)return;
  if(!keychain.keys.length){list.innerHTML='<div style="color:var(--text2);padding:20px;text-align:center;">No keys stored.<br>Import or generate one below.</div>';return;}
  list.innerHTML=keychain.keys.map((k,i)=>{
    const active=i===keychain.activeIndex&&keychain.unlocked;
    return `<div class="key-row ${active?'active':''}" onclick="keychainSelect(${i})"><div class="key-status">${active?'🔓':'🔒'}</div><div class="key-info"><div class="key-label">${escHtml(k.label)}</div><div class="key-npub">${k.npub.slice(0,24)}...</div></div><button class="danger" style="padding:3px 8px;font-size:11px;" onclick="event.stopPropagation();keychainRemove(${i})">✕</button></div>`;
  }).join('');
}

async function keychainImportKey() {
  const input=prompt('Enter nsec or hex private key:'); if(!input)return;
  let hex; if(input.startsWith('nsec1')){hex=decodeNsec(input);if(!hex)return alert('Invalid nsec');}else if(/^[0-9a-f]{64}$/i.test(input)){hex=input.toLowerCase();}else{return alert('Enter a valid nsec1... or 64-char hex key');}
  const label=prompt('Label this key:','')||`Key ${keychain.keys.length+1}`;
  const pw=prompt('Choose an encryption password:'); if(!pw||pw.length<4)return alert('Password must be at least 4 characters');
  try{await keychainAddKey(label,hex,pw);}catch(e){alert('Failed: '+e.message);}
}

async function keychainGenerate() {
  const ok = await loadCrypto();
  if (!ok) return alert('Crypto library could not load.\n\nPlease check your internet connection and refresh the page.\n\nThe library loads from CDN (esm.sh or jsdelivr).');
  const hex=bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
  const label=prompt('Label this key:','New Key '+(keychain.keys.length+1));
  const pw=prompt('Choose an encryption password:'); if(!pw||pw.length<4)return alert('Password must be at least 4 characters');
  try{
    const entry=await keychainAddKey(label,hex,pw);
    alert(`Key generated!\n\nnpub: ${entry.npub}\nnsec: ${nsecEncode(hex)}\n\n⚠️ Save your nsec somewhere safe — it won't be shown again!`);
  }catch(e){alert('Failed: '+e.message);}
}

function openKeychainModal() { document.getElementById('keychainModal').classList.add('show'); renderKeychain(); }
function closeKeychainModal() { document.getElementById('keychainModal').classList.remove('show'); }
