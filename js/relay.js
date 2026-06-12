// ============================================
// js/relay.js — RelayPool, NIP-42, Relay Manager UI, NIP-11
// ============================================

class RelayPool {
  constructor() {
    this.connections = new Map();
    this._onEvent = null;
    this._seenEvents = new Set();
  }

  connect(url) {
    if (this.isConnected(url)) return;
    const conn = { ws:null, status:'connecting', latency:0, msgCount:0, errorCount:0 };
    this.connections.set(url, conn);
    this._emitUI();
    this._log(url, 'info', `Connecting to ${url}...`);
    try {
      const ws = new WebSocket(url);
      conn.ws = ws;
      const t0 = Date.now();
      ws.onopen = () => { conn.status='connected'; conn.latency=Date.now()-t0; this._log(url,'info',`✅ Connected (${conn.latency}ms)`); this._emitUI(); fetchRelayInfo(url); };
      ws.onclose = () => { conn.status='disconnected'; conn.ws=null; this._log(url,'info','Connection closed'); this._emitUI(); };
      ws.onerror = () => { conn.status='disconnected'; conn.errorCount++; this._log(url,'err','WebSocket error'); this._emitUI(); };
      ws.onmessage = (msg) => { conn.msgCount++; this._handleMessage(msg.data, url); };
    } catch(e) { conn.status='disconnected'; this._log(url,'err',`Failed: ${e.message}`); this._emitUI(); }
  }

  disconnect(url) {
    const c=this.connections.get(url); if(c?.ws?.readyState<=1) c.ws.close();
    this.connections.set(url,{ws:null,status:'disconnected',latency:0,msgCount:0,errorCount:0});
    this._emitUI();
  }

  connectAll() { relaySettings.forEach(r=>this.connect(r.url)); }
  disconnectAll() { relaySettings.forEach(r=>this.disconnect(r.url)); }
  isConnected(url) { const c=this.connections.get(url); return c?.ws?.readyState===1; }
  status(url) { return this.connections.get(url)?.status||'disconnected'; }

  getByMode(mode) {
    return relaySettings.filter(r => {
      if(!r[mode])return false;
      const c=this.connections.get(r.url); return c?.status==='connected';
    });
  }

  broadcast(data, mode='read') {
    const relays=this.getByMode(mode);
    if(!relays.length){this._log(null,'err',`No connected ${mode} relays`);return 0;}
    let sent=0;
    relays.forEach(r=>{const c=this.connections.get(r.url);if(c?.ws?.readyState===1){c.ws.send(data);if(mode==='write')this._log(r.url,'out',typeof data==='string'&&data.length>300?data.slice(0,300)+'...':data);sent++;}});
    return sent;
  }

  getStats(url) { const c=this.connections.get(url); return c?{status:c.status,latency:c.latency,msgCount:c.msgCount,errorCount:c.errorCount}:null; }

  _handleMessage(data, fromUrl) {
    try {
      const p=JSON.parse(data); const type=p[0];
      switch(type) {
        case 'EVENT': {
          const evt=p[2];
          if(this._seenEvents.has(evt.id))return;
          this._seenEvents.add(evt.id);
          if(this._seenEvents.size>10000){const a=[...this._seenEvents];this._seenEvents=new Set(a.slice(a.length-5000));}
          events.push(evt);
          addEventCard(evt);
          document.getElementById('eventCount').textContent=events.length;
          this._log(fromUrl,'in',`EVENT kind=${evt.kind} id=${evt.id?.slice(0,12)}...`);
          updateFilterChips();
          if(this._onEvent) this._onEvent(evt,fromUrl);
          break;
        }
        case 'EOSE': {
          const elapsed=Date.now()-queryStartTime;
          document.getElementById('queryTime').textContent=elapsed+'ms';
          this._log(fromUrl,'in',`EOSE sub=${p[1]} (${events.length} events, ${elapsed}ms)`);
          updateFilterChips();
          break;
        }
        case 'OK': this._log(fromUrl,'in',`OK id=${p[1]?.slice(0,12)}... success=${p[2]} msg="${p[3]}"`); break;
        case 'COUNT': this._log(fromUrl,'in',`COUNT sub=${p[1]} count=${p[2]?.count}`); break;
        case 'NOTICE': this._log(fromUrl,'in',`NOTICE: ${p[1]}`); break;
        case 'AUTH': this._handleNip42Auth(p[1],fromUrl); break;
        default: this._log(fromUrl,'in',`Unknown: ${JSON.stringify(p).slice(0,200)}`);
      }
    } catch(e) { this._log(null,'err',`Parse error: ${e.message}`); }
  }

  async _handleNip42Auth(challenge, relayUrl) {
    this._log(relayUrl,'in',`AUTH challenge received`);
    let privkey = getActivePrivkey();
    // NIP-07 extension path
    if(!privkey && isNip07Enabled()) {
      try {
        const pubkey=await nip07GetPubkey(); if(!pubkey)return;
        const event={kind:22242,content:'',tags:[['relay',relayUrl],['challenge',challenge]],created_at:Math.floor(Date.now()/1000),pubkey};
        const signed=await nip07SignEvent(event);
        if(signed){const c=this.connections.get(relayUrl);if(c?.ws?.readyState===1){c.ws.send(JSON.stringify(['AUTH',signed]));this._log(relayUrl,'out','NIP-42 AUTH sent (extension)');}}
      }catch(e){console.warn('NIP-42 extension failed',e);}
      return;
    }
    if(!privkey){this._log(relayUrl,'info','NIP-42 skipped — no active key. Login to authenticate.');return;}
    await loadCrypto(); if(!schnorr)return;
    const pubkey=schnorrGetPublicKeyHex(privkey);
    const event={kind:22242,content:'',tags:[['relay',relayUrl],['challenge',challenge]],pubkey,created_at:Math.floor(Date.now()/1000)};
    const signed=await signEvent(event,privkey);
    const c=this.connections.get(relayUrl);
    if(c?.ws?.readyState===1){c.ws.send(JSON.stringify(['AUTH',signed]));this._log(relayUrl,'out',`NIP-42 AUTH sent (id=${signed.id.slice(0,12)}...)`);}
  }

  nip42Reauth() {
    this.connections.forEach((conn,url)=>{if(conn.status==='connected')this._log(url,'info','Identity changed — will re-auth on next AUTH challenge');});
  }

  _log(url,type,msg) { wsLogGeneric(url?getRelayLabel(url):null,type,msg); }
  _emitUI() { updateRelayStatusBar(); updateRelayManagerList(); }
}

// ── Relay Status Bar ──
function updateRelayStatusBar() {
  const bar=document.getElementById('relayStatusBar'); let html='';
  relaySettings.forEach(r=>{
    const s=pool.getStats(r.url)||{};
    const dc=s.status==='connected'?'connected':s.status==='connecting'?'connecting':'';
    const rw=(r.read&&r.write)?'RW':r.read?'R':r.write?'W':'—';
    html+=`<div class="relay-pill" title="${escHtml(r.url)}\n${r.label} | ${rw}${s.latency?' | '+s.latency+'ms':''}" onclick="openRelayManager()"><div class="pill-dot ${dc}" style="${s.status==='connected'?'background:'+r.color:''}"></div><span class="pill-label">${escHtml(r.label||r.url.replace(/^wss?:\/\//,'').slice(0,20))}</span><span class="pill-rw">${rw}</span></div>`;
  });
  html+=`<button class="relay-manage-btn" onclick="openRelayManager()">⚙</button>`;
  bar.innerHTML=html;
  const el=document.getElementById('queryRelayCount'); if(el)el.textContent=pool.getByMode('read').length;
}

function openRelayManager() { switchTab('relays'); updateRelayManagerList(); }

function updateRelayManagerList() {
  const c=document.getElementById('relayManagerList'); if(!c)return; let html='';
  relaySettings.forEach((r,i)=>{
    const s=pool.getStats(r.url)||{};
    const dc=s.status==='connected'?'connected':s.status==='connecting'?'connecting':'';
    const h=s.errorCount>0?`<span style="color:var(--red);font-size:10px;">⚠${s.errorCount}</span>`:'';
    const l=s.latency?`<span style="color:var(--text2);font-size:10px;">${s.latency}ms</span>`:'';
    html+=`<div class="relay-row" data-index="${i}"><div class="relay-dot ${dc}" style="${s.status==='connected'?'background:'+r.color:''}"></div><input class="relay-label-input" value="${escHtml(r.label)}" onchange="relaySettings[${i}].label=this.value;saveSettings();updateRelayStatusBar();"><span class="relay-url" title="${escHtml(r.url)}">${escHtml(r.url)}</span>${l}${h}<input type="color" value="${r.color}" style="width:24px;height:24px;border:none;background:none;cursor:pointer;padding:0;" onchange="relaySettings[${i}].color=this.value;saveSettings();updateRelayStatusBar();updateRelayManagerList();"><button class="toggle-btn ${r.read?'on':''}" onclick="relaySettings[${i}].read=!relaySettings[${i}].read;saveSettings();updateRelayStatusBar();updateRelayManagerList();">R</button><button class="toggle-btn ${r.write?'on':''}" onclick="relaySettings[${i}].write=!relaySettings[${i}].write;saveSettings();updateRelayStatusBar();updateRelayManagerList();">W</button><button class="toggle-btn ${s.status==='connected'?'on':''}" onclick="connToggle(${i})">${s.status==='connected'?'⏹':'▶'}</button><button class="danger" style="padding:3px 8px;font-size:11px;" onclick="removeRelay(${i})">✕</button></div>`;
  });
  if(!html) html='<div style="color:var(--text2);padding:20px;text-align:center;">No relays configured.</div>';
  c.innerHTML=html;
}

function connToggle(i) { const r=relaySettings[i]; if(!r)return; pool.isConnected(r.url)?pool.disconnect(r.url):pool.connect(r.url); }
function removeRelay(i) { const r=relaySettings[i]; if(!r||!confirm(`Remove relay "${r.label||r.url}"?`))return; pool.disconnect(r.url); relaySettings.splice(i,1); saveSettings(); updateRelayStatusBar(); updateRelayManagerList(); }
function addNewRelayRow() { const url=prompt('Enter relay WebSocket URL:','wss://'); if(!url||!url.startsWith('ws'))return; const label=prompt('Label (optional):','')||url.replace(/^wss?:\/\//,'').split('.')[0]; relaySettings.push({url,label,read:true,write:true,color:RELAY_COLORS[relaySettings.length%RELAY_COLORS.length]}); saveSettings(); updateRelayStatusBar(); updateRelayManagerList(); }

// ── WS Log ──
function wsLogGeneric(label,type,msg) {
  const log=document.getElementById('wsLog'); if(!log)return;
  const ts=new Date().toLocaleTimeString();
  const cls={in:'msg-in',out:'msg-out',err:'msg-err'}[type]||'msg-info';
  const arrow={in:'◀',out:'▶',err:'✖'}[type]||'ℹ';
  const prefix=label?`[${label}] `:'';
  log.innerHTML+=`<div class="${cls}"><span class="msg-ts">${ts}</span>${arrow} ${escHtml(prefix+msg)}</div>`;
  log.scrollTop=log.scrollHeight;
}

// ── NIP-11 Relay Info ──
async function fetchRelayInfo(wsUrl) {
  if(relayInfoCache[wsUrl])return;
  try {
    const http=wsUrl.replace('ws://','http://').replace('wss://','https://');
    const resp=await fetch(http,{headers:{'Accept':'application/nostr+json'}});
    if(!resp.ok)throw new Error(`HTTP ${resp.status}`);
    relayInfoCache[wsUrl]=await resp.json(); renderRelayInfo();
  } catch {}
}

function renderRelayInfo() {
  const el=document.getElementById('statsContent'); const entries=Object.entries(relayInfoCache);
  if(!entries.length){el.innerHTML='<p style="color:var(--text2);">Connect to relays to see info.</p>';return;}
  let html='';
  entries.forEach(([url,info])=>{
    html+=`<h3 style="color:var(--purple);margin:16px 0 12px;">📡 ${escHtml(getRelayLabel(url))}</h3><table style="width:100%;border-collapse:collapse;margin-bottom:16px;">`;
    Object.entries(info).forEach(([k,v])=>{
      html+=`<tr style="border-bottom:1px solid var(--border);"><td style="padding:6px 10px;color:var(--text2);font-size:11px;vertical-align:top;width:150px;">${escHtml(k)}</td><td style="padding:6px 10px;font-size:12px;">${typeof v==='object'?`<pre class="raw-json" style="margin:0;max-height:200px;">${escHtml(JSON.stringify(v,null,2))}</pre>`:escHtml(String(v))}</td></tr>`;
    });
    html+=`</table>`;
  });
  el.innerHTML=html;
}
