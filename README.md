# BnOS Website

Bilingual website for BnOS (Business OS / Bitcoin Nostr Operating System)

## 📁 Structure

```
bnos.space/
├── index.html          # ✅ Language selector with auto-detection
├── css/
│   └── style.css       # ✅ Shared stylesheet (refactored from inline styles)
├── en/                 # English version
│   ├── index.html      # ✅ Main landing page
│   ├── comming.html    # ✅ Coming soon page with countdown
│   └── manual.html     # ✅ Full documentation/manual
└── lo/                 # Lao version (ພາສາລາວ)
    ├── index.html      # ⏳ To be completed (copy & translate from en/index.html)
    ├── comming.html    # ✅ Coming soon page (Lao translation complete)
    └── manual.html     # ⏳ To be completed (copy & translate from en/manual.html)
```

## ✅ Completed Features

### 1. Shared CSS Architecture

- **[css/style.css](css/style.css)** - Centralized stylesheet
- Extracted common styles from inline CSS
- Includes:
  - Navigation & language switcher
  - Buttons & animations
  - Background elements (stars, orbs, gradients)
  - Footer styles
  - Responsive design breakpoints

### 2. Language System

- **Auto-detection**: Detects browser language preference
- **Manual selection**: Language switcher on all pages
- **Persistent**: Remembers user's choice in localStorage
- **Bilingual support**: EN (English) and ລາວ (Lao)

### 3. Completed Pages

#### English (en/)

- ✅ index.html - Full landing page with hero, features, etc.
- ✅ comming.html - Coming soon page with countdown timer
- ✅ manual.html - Complete documentation

#### Lao (lo/)

- ✅ comming.html - Fully translated with Lao font support

### 4. Business pages (`/b/`)

- **b/index.html** - Business/organization presence app addressed by a Nostr key.
- Public page at `bnos.space/b/{npub or NIP-05}` with case studies, capabilities,
  gallery, about, contact and a QR/share link.
- Owner signs in with NIP-07, NIP-46 or a local nsec; only that key can publish.
- Content is a NIP-78 replaceable event (kind `30078`, `d` tag
  `bnos.space:business:v1`), exported and imported as JSON.
- Demo: `bnos.space/b/?demo=1`.
- `b/verify/` contains the synthetic credential-verification concept.
- Uses the landing palette: `#0a0a12` surfaces, gold `#f59e0b` primary,
  violet secondary, and the shared `bnos_theme` light/dark preference.
- Local i18n for English, Lao and Thai (`b/js/data/i18n.js`), with a header
  switcher, `?lang=lo|th` links and the shared `bnos_lang` preference.

Run locally with the included fallback server so `/b/{ref}` resolves:

```sh
node serve.mjs 8080
```

Then open <http://localhost:8080/b/>. On static hosts that support `_redirects`,
the included rule rewrites `/b/*` to `/b/index.html`; on nginx, add an
equivalent `try_files` fallback for `/b/`.

## ⏳ Pending Tasks

### Pages to Complete

1. **lo/index.html** - Translate main landing page to Lao
2. **lo/manual.html** - Translate documentation to Lao

### How to Complete Lao Pages

1. Copy the English version:

   ```bash
   cp en/index.html lo/index.html
   cp en/manual.html lo/manual.html
   ```

2. Update each file:
   - Change `lang="en"` to `lang="lo"`
   - Add Noto Sans Lao font in `<head>`:
     ```html
     <link
       href="https://fonts.googleapis.com/css2?family=Noto+Sans+Lao:wght@300;400;500;600;700;800&display=swap"
       rel="stylesheet"
     />
     ```
   - Update font-family in CSS to include Lao font first
   - Translate all text content to Lao
   - Update language switcher links
   - Update meta tags (title, description) to Lao

## 🚀 Deployment

Deploy the website using:

```bash
./deploy-bnos.sh
```

This script:

- Reads server config from `.env` (SITE_SERVER, SITE_PORT, SITE_REMOTE_PATH)
- Zips the entire `docs/bnos.space` directory
- Uploads to `/var/www/bnos.space/html/`
- Extracts and sets permissions
- Cleans up zip files

## 🎨 Styling Guide

### Using Shared CSS

All pages should link to the shared stylesheet:

```html
<link rel="stylesheet" href="../css/style.css" />
```

### Available CSS Classes

- `.nav` - Fixed navigation bar
- `.lang-switcher` - Language toggle buttons
- `.btn-primary` - Primary orange button
- `.btn-secondary` - Secondary outline button
- `.orb`, `.orb-1`, `.orb-2` - Floating gradient backgrounds
- `.stars` - Animated star field
- `.footer` - Fixed footer with social links

### Animations

- `float` - Floating orb animation
- `pulse` - Pulsing dot/border
- `rotate` - 360° rotation
- `twinkle` - Star twinkling
- `logoGlow` - Logo glow effect

## 🌐 Font Support

### English Pages

```css
font-family:
  "Inter",
  -apple-system,
  BlinkMacSystemFont,
  "Segoe UI",
  Roboto,
  sans-serif;
```

### Lao Pages

```css
font-family:
  "Noto Sans Lao",
  "Inter",
  -apple-system,
  BlinkMacSystemFont,
  sans-serif;
```

## 📝 Translation Guidelines

When translating to Lao:

1. **Maintain structure**: Keep HTML structure identical
2. **Font support**: Always include Noto Sans Lao
3. **Text direction**: Lao is left-to-right (same as English)
4. **Key terms**:
   - Business OS → ລະບົບປະຕິບັດການທຸລະກິດ
   - Lightning → Lightning (keep English)
   - Nostr → Nostr (keep English)
   - Bitcoin → Bitcoin (keep English)
   - Point of Sale → ລະບົບຈຸດຂາຍ

## 🔧 Local Development

To view locally, use any static server:

```bash
# Python 3
python -m http.server 8000

# Node.js
npx serve .

# PHP
php -S localhost:8000
```

Then visit `http://localhost:8000`

## 📞 Support

For questions about the website or translations, refer to the main [DEPLOYMENT.md](../../DEPLOYMENT.md) in the root directory.
