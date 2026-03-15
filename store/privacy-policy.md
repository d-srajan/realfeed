# Privacy Policy — RealFeed

**Effective date:** 2026-03-15

## Summary
RealFeed processes your LinkedIn feed data entirely on your device. No data is collected, stored externally, or transmitted anywhere.

---

## Data collected
RealFeed does **not** collect any personal data.

The extension reads the visible text and images on your LinkedIn feed page for the sole purpose of computing an AI-probability score. This content is:
- Never stored outside your local browser storage
- Never transmitted to any server, API, or third party
- Never shared with the extension developer or anyone else

## Local storage only
RealFeed uses your browser's **IndexedDB** to cache analysis results locally. This cache:
- Is stored only on your device
- Contains hashed representations of post content (not the raw text)
- Expires automatically after 7 days
- Can be cleared at any time by removing the extension or clearing browser storage

## Permissions used
| Permission | Why it's needed |
|---|---|
| `storage` | Save your settings (sensitivity level, on/off toggle) and local result cache |
| `host_permissions: linkedin.com` | Read LinkedIn page content to inject badges and analyze posts |

No other permissions are requested. The extension does not access your LinkedIn credentials, messages, or profile data.

## Third-party services
None. RealFeed makes zero external network requests. All analysis runs locally using WebAssembly.

## Changes to this policy
If the privacy policy changes in a future version, the effective date will be updated and release notes will describe what changed.

## Contact
For questions, open an issue at https://github.com/d-srajan/realfeed
