# BnOS Relay Console — Web Console Design Document

> Extracted from `bnos-landing/console.html` + supporting JS/CSS.
> Purpose: reusable reference for building similar console/debug tools for other Nostr-based systems.

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│  console.html (single-page, no framework)           │
│                                                     │
│  ┌──────────┐  ┌──────────────────────────────┐     │
│  │ Sidebar   │  │  Top Panel (tabbed)          │     │
│  │ Kind      │  │  Timeline | Query | Raw WS   │     │
│  │ Browser   │  │  Publish | Stats | Relays    │     │
│  │           │  ├──────────────┬───────────────┤     │
│  │           │  │ Events List  │ Event Detail  │     │
│  └──────────┘  └──────────────┴───────────────┘     │
│                                                     │
│  JS Modules: core.js → relay.js → events.js →       │
│              console.js (app init)                   │
│  Styles:     css/console.css (single file)           │
└─────────────────────────────────────────────────────┘
         │
         ▼ WebSocket (multi-relay pool)
    ┌────────────┐
    │ Nostr Relay │  (wss://relay.damus.io, etc.)
    └────────────┘
```

### Key Principles
- **Zero dependencies** — no React/Vue/Angular, vanilla JS only
- **Single HTML entry** — loads via `<script>` tags in order
- **CDN crypto** — `@noble/secp256k1` loaded dynamically with multi-CDN fallback
- **Client-only** — all state in memory + localStorage, no backend needed
- **Mobile-first responsive** — CSS grid collapses to single column with drawer nav

---

## 2. File Structure

```
bnos-landing/
├── console.html          ← Main entry, inline styles for nav/theme
├── css/
│   └── console.css       ← All styles (700+ lines), design tokens
├── js/
│   ├── core.js           ← State, constants, utils, crypto, keychain
│   ├── relay.js          ← RelayPool class, NIP-42 auth, relay manager UI
│   ├── events.js         ← Event display, query builder, timeline, saved queries
│   ├── i18n.js           ← (optional) internationalization
│   └── console.js        ← Publish, UI tabs/theme/mobile, INIT bootstrap
├── config.toml           ← Relay server config (not used by frontend)
├── manifest.json         ← PWA manifest
├── sw.js                 ← Service worker
└── icon.svg              ← App icon
```

### JS Load Order (dependency chain)
```html
<script src="js/core.js"></script>      <!-- State, utils, crypto -->
<script src="js/relay.js"></script>     <!-- RelayPool (needs core) -->
<script src="js/events.js"></script>    <!-- Event display (needs core+relay) -->
<script src="js/console.js"></script>   <!-- App init (needs all above) -->
```

---

## 3. Layout & Grid System

### Desktop (≥1000px)
```
CSS Grid: grid-template-columns: 260px 1fr 1fr
           grid-template-rows: auto 1fr

┌──────────┬──────────────────────────────┐
│ Sidebar  │  Tabs (Timeline Query Raw..) │
│ (260px)  │──────────────────────────────│
│          │  Panel Content               │
│ Kind     │                              │
│ Browser  ├──────────────┬───────────────┤
│          │ Events List  │ Event Detail  │
│ (full    │              │               │
│  height) │              │               │
└──────────┴──────────────┴───────────────┘
```

### Tablet (≤1000px)
- Sidebar collapses to top, max-height 200px
- Grid becomes single column
- Events + detail stack vertically

### Phone (≤768px)
- Sidebar → slide-out drawer (transform: translateX)
- Bottom tab bar for navigation
- Query form collapsible (toggle button)
- Detail view overlays events list (full-screen)
- Form inputs font-size: 14px (prevent iOS zoom)

### Phone Small (≤480px)
- Subtitle hidden, logo smaller
- Sidebar 260px width
- Forms stack vertically
- Buttons wrap

---

## 4. Component Design

### 4.1 Header Bar
```
┌────────────────────────────────────────────────────────┐
│ ☰ │ ⚡ BnOS Relay Console │ ←Home │ App↗ │ GitHub↗  │
│   │ Nostr Debug Tool      │       │      │           │
│   │                        │ 🔑Login │ ⚙Manage │ 🟣🔵🟡│ 🌙│
└────────────────────────────────────────────────────────┘
```

- **Hamburger** (mobile only) — toggles sidebar drawer
- **Logo + subtitle** — branding
- **Nav links** — desktop inline, mobile dropdown
- **Identity bar** — login/active key pill with lock button
- **Relay status bar** — colored pills per relay (green=connected, yellow=connecting, red=disconnected)
- **Theme picker** — 5 color dots (Nostr/Bitcoin/Lightning/Ocean/Cyber)
- **Dark/light toggle** — moon/sun button

### 4.2 Sidebar — Kind Browser
- **Search/filter** input with SVG icon, live-filters items by name/number
- **Add Custom Kind** button (dashed border)
- **Grouped sections** with emoji headers:
  - Standard NIP-01 (kinds 0,1,3,4,5,7)
  - Domain-specific sections (Store, Catalog, Orders, CRM, Inventory, Staff, Supply, Accounting, Marketplace, Projects)
  - Custom Kinds (user-added, with edit/delete on hover)
- Each item: `kind-badge` (cyan) + `kind-name` + optional actions
- Click → `quickQuery(kind)` — auto-runs query for that kind

### 4.3 Tab System
6 tabs across the top panel:

| Tab | Icon | Purpose |
|-----|------|---------|
| Timeline | 🕐 | Real-time event feed with category filter |
| Query | 🔍 | Advanced filter builder + event list |
| Raw WS | ⚡ | Direct WebSocket send/receive console |
| Publish | 📝 | Event composer with signing |
| Stats | 📊 | NIP-11 relay info display |
| Relays | 🔌 | Relay manager (add/remove/connect/configure) |

### 4.4 Query Panel
- **Stats bar**: event count, subscription ID, query time, relay count
- **Filter form** (9 fields):
  - Kinds (comma-separated)
  - Authors (pubkey hex)
  - #d tag, #e tag, #p tag
  - Since/Until (unix timestamps)
  - Limit
  - Search (full-text)
- **Action buttons**: Run, Live Mode, All BnOS Kinds, Save, Clear, Export, Stop
- **Saved queries** section with load/delete
- **Filter chips**: auto-generated from results, click to re-query

### 4.5 Timeline Panel
- Live real-time event stream
- **Toolbar**: Start/Stop/Clear + category dropdown filter
- **Cards**: color-coded by kind group, shows parsed JSON fields
- Click card → opens detail view

### 4.6 Raw WebSocket Panel
- **Log area**: color-coded messages (green=in, blue=out, red=error, gray=info)
- **Input textarea**: type raw JSON to send
- **Quick templates**: pre-built REQ/COUNT/CLOSE/EVENT messages
- Timestamps on all messages

### 4.7 Event Detail View
```
📋 Kind 30100 (Product)
├─ Event ID      [click to copy]  note1...
├─ Pubkey        [click to copy]  npub1...
├─ Created At    timestamp (formatted)
├─ Signature     [click to copy]
├─ Tags (N)      formatted array
├─ Content       scrollable, click to copy
├─ Raw JSON      syntax-highlighted
└─ Actions: Copy | Replies | Reactions | Author | Delete
```

### 4.8 Relay Manager
- List of relay rows with:
  - Status dot (connected/connecting/disconnected)
  - Label input (editable inline)
  - URL display
  - Latency badge
  - Color picker
  - R/W toggle buttons
  - Connect/disconnect toggle
  - Remove button
- Bulk actions: Connect All, Disconnect All, Add Relay, Import/Export, Reset

### 4.9 Publish Panel
- Kind + Created At inputs
- Content textarea
- Tags textarea (JSON array of arrays)
- Collapsible signing key (nsec/hex)
- NIP-07 extension detection
- Actions: Publish, Generate Random Key, Test Note
- Generated key info display

---

## 5. Theme System

### Design Tokens (CSS Custom Properties)
All colors use CSS variables for instant theme switching:

```css
:root {
  --bg, --bg2, --bg3          /* 3-level background depth */
  --border, --border-hover     /* border colors */
  --text, --text2, --text-dim  /* 3-level text hierarchy */
  --accent, --accent-hover     /* primary accent */
  --accent-bg                  /* accent background (with alpha) */
  --header-from, --header-to   /* header gradient */
}
```

### Color Themes (5 built-in)
| Theme | Accent | Vibe |
|-------|--------|------|
| Nostr Purple | `#a855f7` | Default, classic |
| Bitcoin Orange | `#f7931a` | Warm, amber tones |
| Lightning Yellow | `#fbbf24` | Bright, electric |
| Ocean Blue | `#3b82f6` | Cool, professional |
| Cyber Green | `#22c55e` | Matrix, terminal feel |

Each theme overrides all design tokens including backgrounds, borders, and header gradients.

### Light/Dark Mode
- Body attribute `data-theme="light"` toggles light mode
- Light mode has its own full set of token overrides
- Combined with color themes: `html[data-theme="bitcoin"] body[data-theme="light"]`
- Persisted in localStorage

---

## 6. State Management

### Global State (core.js)
```javascript
let relaySettings  = [];    // [{url, label, read, write, color}]
let customKinds    = [];    // [{kind, name, emoji, category}]
let events         = [];    // Received Nostr events
let subCounter     = 0;     // Subscription ID counter
let activeSubId    = null;  // Current subscription
let liveMode       = false; // Auto-reconnect mode
let pool;                   // RelayPool instance
let timelineEvents = [];    // Timeline feed events
let keychain       = {};    // {keys[], activeIndex, unlocked, _rawKey}
```

### Persistence (localStorage)
```javascript
STORAGE_KEY → {
  relays: [...],
  customKinds: [...],
  lastQuery: {kinds, authors, dtag, etag, ptag, since, until, limit, search},
  savedQueries: [{name, filter, createdAt}],
  theme: "dark" | "light"
}
KEYCHAIN_KEY → {
  keys: [{label, npub, encPrivkey, iv, created}],
  activeIndex: number
}
```

### Kind Registry
```javascript
KIND_NAMES = { 0:"Profile", 1:"Text Note", 30078:"Store Settings", ... }
KIND_GROUPS = {
  catalog: { kinds:[30100,30101,...], color:'#06b6d4', icon:'🛍', label:'Catalog' },
  ...
}
```

---

## 7. RelayPool Class

### Core API
```javascript
class RelayPool {
  connect(url)            // Open WebSocket, track status
  disconnect(url)         // Close connection
  connectAll()            // Connect all configured relays
  disconnectAll()         // Close all
  isConnected(url)        // Check status
  getByMode(mode)         // Get connected relays by 'read'/'write'
  broadcast(data, mode)   // Send to all relays in mode, returns count
  getStats(url)           // {status, latency, msgCount, errorCount}
}
```

### Message Handling
Parses incoming `["TYPE", ...]` messages:
- `EVENT` → dedup (seenEvents Set), push to array, render card, update chips
- `EOSE` → record query time
- `OK` → log publish confirmation
- `COUNT` → display count result
- `NOTICE` → display relay notice
- `AUTH` → NIP-42 authentication flow

### NIP-42 Authentication
- Detects `AUTH` challenge from relay
- Uses active key (keychain or NIP-07 extension)
- Signs kind 22242 event with relay URL + challenge
- Auto-sends `["AUTH", signedEvent]` back

### Connection State Tracking
Each connection tracks:
```javascript
{ ws, status:'connecting'|'connected'|'disconnected', latency, msgCount, errorCount }
```

---

## 8. Cryptography

### Key Management
- **Keychain**: AES-256-GCM encrypted private keys stored in localStorage
  - Password-derived via PBKDF2 (100k iterations, SHA-256)
  - Each key has unique IV
  - Keys never stored unencrypted
- **NIP-07**: Browser extension support (Alby, nos2x, etc.)
- **Manual**: Direct nsec/hex input for testing
- **Random generation**: `crypto.getRandomValues(new Uint8Array(32))`

### Event Signing
```javascript
serializeEvent(evt) → JSON.stringify([0, pubkey, created_at, kind, tags, content])
sha256(serialized) → event ID
schnorr.sign(id, privkey) → signature
```

### Bech32 Encoding
Custom implementation (no dependencies):
- `npubEncode(hex)` / `nsecEncode(hex)` / `noteEncode(hex)`
- `decodeNsec(nsec)` → hex private key

---

## 9. Mobile UX Patterns

### Bottom Navigation Bar
```
┌──────┬──────┬──────┬──────┬──────┐
│ 🕐   │ 🔍   │ 📋   │ 📝   │ 🔌   │
│ Feed │Query │Events│Publish│Relays│
└──────┴──────┴──────┴──────┴──────┘
```

### Sidebar Drawer
- Hamburger button → slides sidebar from left
- Dark overlay behind (backdrop-filter: blur)
- Click overlay or sidebar item → close drawer

### Detail Full-Screen
- On event click → detail replaces events list
- "← Back to events" sticky header
- Slide-up animation

### Collapsible Query Form
- Toggle button "▼ Show Filters" / "▲ Hide Filters"
- `max-height` transition animation
- State persisted via `dataset.userExpanded`

---

## 10. Modals

### Pattern
```html
<div class="modal-overlay" id="xxxModal">  <!-- display:none → .show = flex -->
  <div class="modal">
    <h2>Title</h2>
    <!-- form fields -->
    <div class="btn-row">
      <button onclick="closeXxxModal()">Cancel</button>
      <button class="primary" onclick="saveXxx()">Save</button>
    </div>
  </div>
</div>
```

### Modals Used
- **Add Custom Kind** — kind number, name, emoji, category
- **Import/Export Kinds** — JSON textarea, copy/import buttons
- **Keychain** — key list with lock/unlock, import nsec, generate new

---

## 11. Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Enter` | Run query / Send WS / Publish (context-aware) |
| `Escape` | Close any open modal |

---

## 12. Reusable Patterns for Other Projects

### Pattern: Kind-Based Domain Sections
The sidebar groups events by domain. To adapt for another system:

1. Define your `KIND_NAMES` map
2. Define `KIND_GROUPS` with color/icon/kind arrays
3. Add sidebar sections in HTML
4. The rest (query, display, filter chips) works automatically

### Pattern: Multi-Relay Pool
The `RelayPool` class is generic — works with any Nostr relay:
- Add/remove relays dynamically
- Per-relay read/write mode
- Latency tracking
- NIP-42 auto-auth
- Message dedup

### Pattern: Theme System
To add a new color theme:
```css
[data-theme="your-theme"] {
  --accent: #yourcolor;
  --accent-hover: #darkerversion;
  --accent-bg: rgba(..., 0.15);
  --header-from: #dark;
  --header-to: #slightly-lighter;
  /* override bg, bg2, bg3, border, text for unique feel */
}
```

### Pattern: Zero-Dependency SPA
- No build step, no bundler
- CSS custom properties for theming
- Global functions (not modules) for simplicity
- localStorage for persistence
- Dynamic `import()` for crypto only
- Works as static files on any host (GitHub Pages, IPFS, etc.)

### Pattern: Event Detail Viewer
Reusable event detail component:
- Copy-on-click for all fields
- Bech32 encoding (note/npub)
- Tag formatting
- Action buttons (replies, reactions, author query, delete)
- Raw JSON display

---

## 13. BnOS-Specific Kind Registry

For reference when building similar domain-specific systems:

| Range | Domain | Key Kinds |
|-------|--------|-----------|
| 30078-30080 | Store Config | Settings, Profile, Table Layout |
| 30100-30106 | Catalog | Product, Category, Unit, Modifier, Ingredient, Recipe |
| 30200-30207 | Transactions | Order, Payment, Refund, Invoice, Contract, Rental |
| 30300-30313 | CRM & Loyalty | Customer, Loyalty Points, Coupon, Membership, Promotion |
| 30400-30401 | Inventory | Stock Adjustment, Inventory Count |
| 30500-30591 | Staff & Access | Staff Member, POS Session, Company Index, Workspaces |
| 30600 | Branch | Branch |
| 30700-30703 | Supply Chain | Supplier, Branch Stock, Purchase Order, Stock Transfer |
| 30800-30803 | Accounting | Account, Journal Entry, Expense, Financial Report |
| 30900 | Chat | Chat Channel |
| 30950-30955 | Marketplace | Listing, Product, Order, Review |
| 31100-31109 | Project Mgr | Project, Issue, Wiki Page |

---

## 14. Checklist: Building a New Console

- [ ] Define `KIND_NAMES` and `KIND_GROUPS` for your domain
- [ ] Add sidebar sections with your kind groups
- [ ] Set default relays in `DEFAULT_RELAYS`
- [ ] Customize theme colors (or keep defaults)
- [ ] Add domain-specific templates to Raw WS panel
- [ ] Customize publish panel defaults (kind, content)
- [ ] Update PWA manifest (name, icon, colors)
- [ ] Add service worker for offline support
- [ ] Test mobile responsive breakpoints
- [ ] Configure NIP-42 for authenticated relays
- [ ] Set up keychain encryption salt unique to your app
