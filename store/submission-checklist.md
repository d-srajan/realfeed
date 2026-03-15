# Chrome Web Store Submission Checklist — RealFeed

## Before you submit

### Code & build
- [ ] Run `npx webpack --mode production` (minified build for submission)
- [ ] Test production build on LinkedIn — badges appear, no console errors
- [ ] Verify manifest version is correct (currently `0.1.0`)
- [ ] Zip the `dist/` folder: `cd dist && zip -r ../realfeed-v0.1.0.zip .`

### Account
- [ ] Register at https://chrome.google.com/webstore/devconsole
- [ ] Pay one-time $5 developer registration fee
- [ ] Verify your email address

### Store assets (required)
- [ ] **Icon 128×128 PNG** — already at `extension/icons/icon128.png`
- [ ] **At least 1 screenshot** — 1280×800 px or 640×400 px PNG/JPG
  - Suggested: LinkedIn feed with 3-4 visible badges
- [ ] **Short description** — max 132 chars (see store/store-listing.md)
- [ ] **Full description** — copy from store/store-listing.md
- [ ] **Privacy policy URL** — host the contents of store/privacy-policy.md
  - Easiest: create a GitHub Pages site or use a GitHub raw link

### Store assets (optional but recommended)
- [ ] Promo tile 440×280 px — increases click-through rate significantly
- [ ] Additional screenshots (up to 5 total)

### Privacy & permissions justification
Google will ask you to justify each permission. Use these answers:

| Permission | Justification |
|---|---|
| `storage` | Store user settings (sensitivity, on/off) and local analysis cache |
| `host_permissions: linkedin.com` | Required to inject badge UI and read post text/images for local analysis |

### Review prep
- [ ] Make sure no `eval()` or remote code execution exists in the bundle
- [ ] Check that no `http://` requests are made (only local extension URLs)
- [ ] Confirm the extension only runs on `linkedin.com` (scoped host permission)

## Submission steps
1. Go to https://chrome.google.com/webstore/devconsole
2. Click **Add new item**
3. Upload `realfeed-v0.1.0.zip`
4. Fill in store listing from `store/store-listing.md`
5. Upload icon and screenshots
6. Add privacy policy URL
7. Answer permissions justification questions
8. Submit for review (typically 1-3 business days)

## After approval
- [ ] Tag the GitHub release: `git tag v0.1.0 && git push origin v0.1.0`
- [ ] Attach `realfeed-v0.1.0.zip` to the GitHub release
- [ ] Update README with Chrome Web Store install link
