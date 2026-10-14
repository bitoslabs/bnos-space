// ============================================
// js/terminal.js — Terminal (Command Console)
// ============================================
// A high-level command line over the relay pool, shown in the Terminal tab.
// Commands: query 30100 --limit 20, all, live, relays, help, ...

const TERM_HISTORY = [];
let termHistIdx = 0;
let termBannerShown = false;

function termEl(id) { return document.getElementById(id); }

function termPrint(html, cls) {
  const log = termEl('termLog'); if (!log) return;
  const line = document.createElement('div');
  line.className = 'term-line' + (cls ? ' ' + cls : '');
  line.innerHTML = html;
  log.appendChild(line);
  while (log.children.length > 500) log.removeChild(log.firstChild);
  log.scrollTop = log.scrollHeight;
}

function termEcho(cmd) {
  const log = termEl('termLog'); if (!log) return;
  const line = document.createElement('div');
  line.className = 'term-line cmd';
  line.textContent = '\u203a ' + cmd;
  log.appendChild(line);
  log.scrollTop = log.scrollHeight;
}

function termClear() { const l = termEl('termLog'); if (l) l.innerHTML = ''; }

function termBanner() {
  termPrint('<b>BnOS Relay Console</b> \u2014 a command line over Nostr relays.', 'info');
  termPrint('Try: <b>query 30100 --limit 20</b> \u00b7 <b>query all</b> \u00b7 <b>live</b> \u00b7 <b>relays</b> \u00b7 <b>help</b>', 'muted');
}

function focusTerminalInput() {
  const i = termEl('termInput'); if (i) i.focus();
  if (!termBannerShown) { termBannerShown = true; termBanner(); }
}

function termVisible() {
  const p = termEl('panel-terminal');
  return !!p && p.classList.contains('active');
}

// ── Parsing helpers ──
function termTokenize(str) {
  const out = []; let cur = ''; let q = null;
  for (const ch of str) {
    if (q) { if (ch === q) q = null; else cur += ch; }
    else if (ch === '"' || ch === "'") q = ch;
    else if (/\s/.test(ch)) { if (cur) { out.push(cur); cur = ''; } }
    else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

function termParseSince(v) {
  if (v == null) return null;
  if (/^\d+$/.test(v)) return parseInt(v, 10);
  const m = /^(\d+)([smhd])$/.exec(v);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  const unit = { s: 1, m: 60, h: 3600, d: 86400 }[m[2]];
  return Math.floor(Date.now() / 1000) - n * unit;
}

function termParseOpts(args) {
  const o = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--limit') o.limit = args[++i];
    else if (a === '--author' || a === '--authors') o.author = args[++i];
    else if (a === '--since') o.since = termParseSince(args[++i]);
    else if (a === '--until') o.until = args[++i];
    else if (a === '--search') o.search = args[++i];
    else if (a === '--d') o.d = args[++i];
    else if (a === '--e') o.e = args[++i];
    else if (a === '--p') o.p = args[++i];
  }
  return o;
}

function termResolveKinds(arg) {
  if (!arg) return [];
  const out = [];
  arg.split(',').map(s => s.trim()).filter(Boolean).forEach(p => {
    if (/^\d+$/.test(p)) { out.push(parseInt(p, 10)); return; }
    const lower = p.toLowerCase();
    const hit = Object.entries(KIND_NAMES).find(([, name]) => {
      const n = String(name).toLowerCase();
      return n === lower || n.includes(lower);
    });
    if (hit) out.push(parseInt(hit[0], 10));
  });
  return [...new Set(out)];
}

function termSetVal(id, v) {
  const el = termEl(id); if (el) el.value = (v == null ? '' : v);
}

// ── Commands ──
const TERM_HELP = [
  '<b>Commands</b>',
  '  <b>query</b> &lt;kinds|name&gt; [--limit N] [--author hex] [--since 7d] [--search text]',
  '                          [--d tag] [--e id] [--p hex]   run a query (alias: q)',
  '  <b>all</b>                 query every known BnOS kind',
  '  <b>live</b>                toggle the live timeline feed',
  '  <b>feed</b> | <b>timeline</b>      open the timeline tab',
  '  <b>events</b>              show the events list',
  '  <b>stop</b>                stop the active subscription / timeline',
  '  <b>relays</b>              list relays with status (alias: ls)',
  '  <b>connect</b> &lt;url&gt;        add and connect a relay',
  '  <b>disconnect</b> &lt;url&gt;     disconnect a relay',
  '  <b>tab</b> &lt;name&gt;           timeline | query | terminal | raw | publish | stats | relays',
  '  <b>theme</b> &lt;name&gt;         nostr | bitcoin | lightning | ocean | cyber',
  '  <b>dark</b> | <b>light</b>        switch light/dark mode',
  '  <b>export</b>              download buffered events as JSON',
  '  <b>clear</b>               clear the console (alias: cls, Ctrl+L)',
  '  <b>help</b>                show this help',
].join('<br>');

const TERM_COMMANDS = {
  help() { termPrint(TERM_HELP, 'info'); },
  clear() { termClear(); },
  cls() { termClear(); },

  query(args) {
    const opts = termParseOpts(args);
    const kindsArg = args.find(a => !a.startsWith('--'));
    if (kindsArg && kindsArg.toLowerCase() === 'all') {
      if (!termRequireRead()) return;
      runQueryAllKinds();
      termPrint('\u25b8 query all BnOS kinds', 'ok');
      return;
    }
    const kinds = termResolveKinds(kindsArg);
    if (!kinds.length) {
      termPrint('Usage: <b>query &lt;kinds|name&gt; [--limit N] [--author hex] [--since 7d] [--search text]</b>', 'err');
      return;
    }
    if (!termRequireRead()) return;
    termSetVal('qKinds', kinds.join(','));
    termSetVal('qLimit', opts.limit || '100');
    termSetVal('qAuthors', opts.author || '');
    termSetVal('qSince', opts.since != null ? opts.since : '');
    termSetVal('qUntil', opts.until != null ? opts.until : '');
    termSetVal('qSearch', opts.search || '');
    termSetVal('qDtag', opts.d || '');
    termSetVal('qEtag', opts.e || '');
    termSetVal('qPtag', opts.p || '');
    runQuery();
    termPrint(`\u25b8 query kinds=[${kinds.join(', ')}]` +
      (opts.limit ? ` limit=${opts.limit}` : '') +
      (opts.since != null ? ` since=${opts.since}` : '') +
      (opts.author ? ' author=' + escHtml(String(opts.author).slice(0, 12)) + '\u2026' : ''), 'ok');
  },

  all() {
    if (!termRequireRead()) return;
    runQueryAllKinds();
    termPrint('\u25b8 query all BnOS kinds', 'ok');
  },

  live() {
    if (timelineLiveSub == null) {
      if (!termRequireRead()) return;
      startTimeline();
      termPrint('Live timeline: <b>ON</b>', 'ok');
    } else {
      stopTimeline();
      termPrint('Live timeline: <b>OFF</b>', 'info');
    }
  },

  feed() { switchTab('timeline'); termPrint('Opened timeline', 'info'); },
  timeline() { switchTab('timeline'); termPrint('Opened timeline', 'info'); },

  events() {
    switchTab('query');
    termPrint(`${events.length} event(s) in buffer`, 'info');
  },

  stop() {
    stopSubscription();
    if (timelineLiveSub != null) stopTimeline();
    termPrint('Stopped active subscription and timeline', 'info');
  },

  relays() {
    if (!relaySettings.length) { termPrint('No relays configured.', 'warn'); return; }
    relaySettings.forEach(r => {
      const s = pool.getStats(r.url) || {};
      const st = s.status || 'disconnected';
      const cls = st === 'connected' ? 'ok' : st === 'connecting' ? 'warn' : 'err';
      const rw = (r.read && r.write) ? 'RW' : r.read ? 'R' : r.write ? 'W' : '\u2014';
      termPrint(`${escHtml(r.url)} <span class="term-dim">${rw} \u00b7 ${st}${s.latency ? ' \u00b7 ' + s.latency + 'ms' : ''}</span>`, cls);
    });
  },
  ls() { TERM_COMMANDS.relays(); },

  connect(args) {
    const url = args[0];
    if (!url || !url.startsWith('ws')) { termPrint('Usage: <b>connect wss://relay.example</b>', 'err'); return; }
    if (!relaySettings.some(r => r.url === url)) {
      relaySettings.push({
        url,
        label: url.replace(/^wss?:\/\//, '').split('.')[0],
        read: true, write: true,
        color: RELAY_COLORS[relaySettings.length % RELAY_COLORS.length],
      });
      saveSettings(); updateRelayStatusBar(); updateRelayManagerList();
    }
    pool.connect(url);
    termPrint('Connecting to ' + escHtml(url) + '\u2026', 'info');
  },

  disconnect(args) {
    const url = args[0];
    if (!url) { termPrint('Usage: <b>disconnect &lt;url&gt;</b>', 'err'); return; }
    pool.disconnect(url);
    termPrint('Disconnected ' + escHtml(url), 'info');
  },

  tab(args) {
    const t = (args[0] || '').toLowerCase();
    const valid = ['timeline', 'query', 'terminal', 'raw', 'publish', 'stats', 'relays'];
    if (!valid.includes(t)) { termPrint('Tabs: ' + valid.join(', '), 'err'); return; }
    switchTab(t);
    termPrint('Switched to <b>' + t + '</b>', 'info');
  },

  theme(args) {
    const t = (args[0] || '').toLowerCase();
    const valid = ['nostr', 'bitcoin', 'lightning', 'ocean', 'cyber'];
    if (!valid.includes(t)) { termPrint('Themes: ' + valid.join(', '), 'err'); return; }
    setColorTheme(t);
    termPrint('Color theme: <b>' + t + '</b>', 'ok');
  },

  dark() { setTheme('dark'); termPrint('Dark mode', 'ok'); },
  light() { setTheme('light'); termPrint('Light mode', 'ok'); },

  export() {
    if (!events.length) { termPrint('No events to export.', 'warn'); return; }
    exportEvents();
    termPrint(`Exported ${events.length} event(s)`, 'ok');
  },
};

function termRequireRead() {
  if (!pool.getByMode('read').length) {
    termPrint('No connected read relays. Try <b>relays</b> or <b>connect wss://\u2026</b>', 'err');
    return false;
  }
  return true;
}

function termCommand(line) {
  const raw = (line == null ? '' : String(line)).trim();
  if (!raw) return;
  termEcho(raw);
  const parts = termTokenize(raw);
  const cmd = (parts[0] || '').toLowerCase();
  const handler = TERM_COMMANDS[cmd];
  if (!handler) { termPrint(`Unknown command: <b>${escHtml(cmd)}</b>. Try <b>help</b>.`, 'err'); return; }
  try { handler(parts.slice(1)); }
  catch (e) { termPrint('Error: ' + escHtml(e.message || String(e)), 'err'); }
}

function termSubmit() {
  const input = termEl('termInput'); if (!input) return;
  const val = input.value.trim();
  if (!val) return;
  TERM_HISTORY.push(val);
  termHistIdx = TERM_HISTORY.length;
  termCommand(val);
  input.value = '';
}

// ── Live relay echo (only while the terminal tab is visible) ──
window.onRelayMessage = function (type, p, fromUrl) {
  if (!termVisible()) return;
  if (type === 'EVENT') {
    if (p[1] !== activeSubId) return;
    const evt = p[2] || {};
    termPrint(
      `<span class="term-dim">${escHtml(formatTime(evt.created_at))}</span> ` +
      `<b>${escHtml(String(evt.kind))}</b> ${escHtml(getKindName(evt.kind))} ` +
      `<span class="term-dim">${escHtml(String(evt.pubkey || '').slice(0, 12))}\u2026 ${(evt.tags || []).length}t</span> ` +
      escHtml(truncate(evt.content, 90)), 'evt');
  } else if (type === 'EOSE') {
    if (p[1] !== activeSubId) return;
    termPrint(`\u2713 End of stored events \u00b7 ${events.length} received`, 'ok');
  } else if (type === 'OK') {
    termPrint(`OK ${escHtml(String(p[1] || '').slice(0, 12))}\u2026 ${p[2] ? '\u2713' : '\u2717'} ${escHtml(p[3] || '')}`, p[2] ? 'ok' : 'err');
  } else if (type === 'COUNT') {
    const c = (p[2] && p[2].count != null) ? p[2].count : '\u2014';
    termPrint(`Count ${escHtml(p[1] || '')}: ${c}`, 'info');
  } else if (type === 'NOTICE') {
    termPrint('Notice: ' + escHtml(p[1] || ''), 'warn');
  }
};

// ── Init ──
(function termInit() {
  const form = termEl('termForm');
  const input = termEl('termInput');
  if (form) form.addEventListener('submit', e => { e.preventDefault(); termSubmit(); });
  if (input) {
    input.addEventListener('keydown', e => {
      if (e.key === 'ArrowUp') {
        if (!TERM_HISTORY.length) return;
        e.preventDefault();
        termHistIdx = Math.max(0, termHistIdx - 1);
        input.value = TERM_HISTORY[termHistIdx];
      } else if (e.key === 'ArrowDown') {
        if (!TERM_HISTORY.length) return;
        e.preventDefault();
        if (termHistIdx >= TERM_HISTORY.length - 1) { termHistIdx = TERM_HISTORY.length; input.value = ''; }
        else { termHistIdx++; input.value = TERM_HISTORY[termHistIdx]; }
      } else if (e.key === 'l' && e.ctrlKey) {
        e.preventDefault(); termClear();
      }
    });
  }
  // Global shortcut: "/" opens the Terminal tab and focuses the input.
  document.addEventListener('keydown', e => {
    if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    if (typing) return;
    e.preventDefault();
    switchTab('terminal');
  });
})();
