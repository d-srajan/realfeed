# Changelog — RealFeed

## v0.1.0 — 2026-03-15 (Initial release)

### Added
- AI-probability badge injected inline next to each LinkedIn post
- Multi-layer heuristic text analysis:
  - Sentence burstiness and TTR/MATTR vocabulary diversity
  - Sentence-starter diversity and punctuation profile
  - Word-length distribution and character Shannon entropy
  - AI phrase detection (70+ weighted phrases)
  - Hedging, transition, and filler density
  - LinkedIn post structure detection (list posts, hook-heavy openers)
  - Emoji/hashtag clustering and repetition detection
- Image analysis:
  - EXIF/metadata inspection for AI-generation software markers
  - 2D FFT spectral analysis for GAN/diffusion-model frequency artifacts
- Lazy evaluation — posts analyzed only when they enter the viewport
- Debounced analysis queue (max 2 concurrent, AbortController cancellation)
- IndexedDB result cache (7-day TTL, FNV-1a content hashing)
- Optional ONNX ML layer: DistilBERT (text) + EfficientNet-Lite (images)
  — graceful degradation when model files are absent
- Badge states: dormant → analyzing → preliminary → final score
- Color coding: green (likely human) / yellow (mixed) / red (likely AI)
- Popup settings: enable toggle, sensitivity (low/medium/high), text/image toggles
- 100% local — zero external network requests, no accounts, no telemetry
