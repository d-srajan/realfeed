# Chrome Web Store — Submission Checklist

## Pre-submission Requirements

### Extension Package
- [ ] `npx webpack --mode production` — production build
- [ ] Zip the `dist/` folder: `zip -r realfeed.zip dist/`
- [ ] Verify `manifest.json` version is bumped before each release

### Required Assets
- [ ] **Icon 128×128** — `dist/icons/icon128.png` ✅
- [ ] **Promotional tile 440×280** — `store/promo-tile-440x280.png` (create in Figma/Canva)
- [ ] **Screenshots** — 1280×800 or 640×400, at least 1, up to 5 (see `store/screenshots/`)
- [ ] **Privacy policy** — hosted URL required (see `store/privacy-policy.html`)

### Store Listing Fields
- **Name:** RealFeed
- **Summary (≤132 chars):** Spot AI-generated content instantly on LinkedIn — 100% local, no data sent anywhere.
- **Category:** Productivity
- **Language:** English

---

## Store Description (copy-paste into CWS)

```
RealFeed adds a small AI-probability badge next to every LinkedIn post. As you scroll, each post is analyzed in real time using a multi-layer detection pipeline running entirely inside your browser — no servers, no API calls, no data ever leaves your device.

HOW IT WORKS
━━━━━━━━━━━━
• Badges appear inline next to the post author — color-coded green (human), yellow (mixed), red (likely AI)
• Lazy evaluation — posts are only analyzed when they scroll into view
• Two-phase scoring — a fast heuristic score appears in ~1 second
• Click any badge to see a per-signal breakdown

WHAT IT DETECTS
━━━━━━━━━━━━━━━
Text signals:
  • Sentence burstiness and length variance
  • Vocabulary diversity (TTR / MATTR)
  • Sentence-starter diversity
  • 70+ weighted AI phrases ("delve into", "paradigm shift", etc.)
  • Hedging and transition density
  • LinkedIn-specific hook patterns

Image signals:
  • EXIF/metadata inspection for AI generation software tags
  • 2D FFT spectral analysis for GAN/diffusion frequency fingerprints

PRIVACY
━━━━━━━
RealFeed makes zero external network requests. Everything runs locally using WebAssembly. No data about you or your feed ever leaves your device.

Permissions used:
  • storage — save settings and local analysis cache
  • linkedin.com access — inject badges and read post text for local analysis

OPEN SOURCE
━━━━━━━━━━━
Source code available at: https://github.com/d-srajan/realfeed
```

---

## Screenshots to Capture (store/screenshots/)

| File | Content |
|------|---------|
| `01-feed-badges.png` | LinkedIn feed with green + yellow badges visible |
| `02-badge-close-up.png` | Zoomed-in badge showing score + color coding |
| `03-detail-panel.png` | Badge clicked showing per-signal breakdown panel |
| `04-popup-settings.png` | Extension popup with sensitivity settings |

---

## Privacy Policy Checklist
- [ ] Hosted at a stable URL (GitHub Pages works: `https://d-srajan.github.io/realfeed/privacy`)
- [ ] States no data collection
- [ ] States no external requests
- [ ] Lists permissions and their purpose
- [ ] Contact email included

---

## Submission Steps

1. Go to [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
2. Pay one-time $5 developer fee (if not already done)
3. Click **Add new item** → upload `realfeed.zip`
4. Fill in store listing fields from this checklist
5. Upload screenshots and promo tile
6. Add privacy policy URL
7. Set **Visibility** → Public
8. Submit for review (typically 1–3 business days)
