# AI Content Detector — Browser Extension Design Plan

## Goal
A Chrome browser extension that detects AI-generated content (text, images, video) in LinkedIn posts and displays a confidence score badge inline next to each post. Fully local — no external API calls or paid services.

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────┐
│                    Browser Extension (MV3)                    │
├────────────┬───────────────┬─────────────────────────────────┤
│  Content   │   Popup UI    │   Background Service Worker      │
│  Script    │  (Settings &  │   (Detection Engine)              │
│            │   Details)    │                                   │
│ • Scrape   │               │ • Analysis Queue (concurrency=2) │
│   posts    │               │ • Text Detection Pipeline        │
│ • Inject   │               │ • Image Detection Pipeline       │
│   badges   │               │ • Video Detection Pipeline       │
│ • Observe  │               │ • Ensemble Scorer                │
│   DOM      │               │ • IndexedDB Result Cache         │
│ • Intersec │               │                                  │
│   tion     │               │                                  │
│   Observer │               │                                  │
│  (lazy     │               │                                  │
│   trigger) │               │                                  │
└────────────┴───────────────┴─────────────────────────────────┘

Flow:  Post in DOM ──▶ Enters Viewport ──▶ Debounce 300ms ──▶ Queue ──▶ Analyze ──▶ Badge
                       (IntersectionObs)    (skip if scrolled)  (max 2)   (heuristic → ML)
```

---

## 1. Inline Badge UI (Content Script)

### Badge Placement
Each LinkedIn post gets a small circular badge injected next to the post header (author name / timestamp area).

```
┌─────────────────────────────────────────────┐
│  👤 John Doe  · 2h · 🌐        [72% AI]    │
│─────────────────────────────────────────────│
│                                             │
│  Post content here...                       │
│                                             │
│  [🖼️ Image: 85% AI]                        │
│                                             │
└─────────────────────────────────────────────┘
```

### Badge Design
- **Circular badge** with percentage: `72% AI`
- **Color coded**:
  - 🟢 Green (0-30%): Likely human
  - 🟡 Yellow (31-60%): Mixed/uncertain
  - 🔴 Red (61-100%): Likely AI-generated
- **Separate badges** for text vs media when both are present
- **Click to expand**: shows breakdown panel with per-signal scores

### Badge Injection Strategy
- Use `MutationObserver` on LinkedIn's feed container to detect new posts as user scrolls
- Identify post containers via LinkedIn's DOM structure (data-urn attributes, feed-shared-update selectors)
- Inject badge as a child element of the post header row
- Use Shadow DOM for badge styling isolation (prevents LinkedIn CSS conflicts)
- Track processed posts via `data-ai-checked` attribute to avoid duplicate badges

### Lazy Evaluation Strategy

Scores are **NOT** precomputed for all posts. Analysis is triggered lazily based on viewport visibility.

#### How It Works

```
  ┌─────────────────── Viewport ───────────────────┐
  │                                                 │
  │  Post A  [72% AI]    ← already analyzed         │
  │                                                 │
  │  Post B  [  ⏳  ]    ← enters viewport,         │
  │                        queued for analysis       │
  │                                                 │
  ├─────────────────────────────────────────────────┤
  │  Post C  [  ── ]     ← below viewport,          │
  │                        NOT analyzed yet          │
  │  Post D  [  ── ]     ← NOT analyzed yet          │
  │  Post E  [  ── ]     ← NOT analyzed yet          │
  └─────────────────────────────────────────────────┘
```

#### Lifecycle of a Post Badge

```
 Post enters DOM          Post enters viewport       Analysis complete
 (MutationObserver)       (IntersectionObserver)      (callback)
       │                         │                         │
       ▼                         ▼                         ▼
  ┌──────────┐            ┌────────────┐            ┌────────────┐
  │ Dormant  │───scroll──▶│  Queued /   │───done───▶│  Scored    │
  │ [  ── ]  │            │  Analyzing  │           │  [72% AI]  │
  │          │            │  [  ⏳  ]   │           │            │
  └──────────┘            └────────────┘            └────────────┘
       │                                                  │
       │◀──── scrolls away before analysis ───────────────│
       │      (cancel if still pending)                   │
```

#### Implementation Details

1. **IntersectionObserver** watches all post containers with a root margin of `200px` (starts analysis slightly before post is fully visible for a seamless feel)
2. **Analysis queue** with concurrency limit of 2 — prevents CPU spikes when scrolling fast through many posts
3. **Debounced queuing** — post must remain in viewport for 300ms before analysis starts (skip posts during fast scrolling)
4. **Cancellation** — if a post leaves the viewport before analysis completes, cancel in-flight work and deprioritize
5. **Cache check first** — before queuing, check IndexedDB cache by post content hash; if cached, show result instantly without re-analysis
6. **Priority**: text heuristics run first (instant) → show preliminary score → ML model runs async → update badge with final score
7. **Video**: never auto-analyzed; always requires explicit user click ("Analyze Video" button) regardless of viewport

#### Queue Manager

```javascript
// Pseudocode for the analysis queue
class AnalysisQueue {
  maxConcurrent = 2;           // max parallel analyses
  viewportDebounceMs = 300;    // wait before committing to analysis
  pending = new Map();         // postId → { timer, abortController }
  active = new Set();          // currently running analyses

  onPostVisible(postId, postData) {
    // Debounce: only queue if post stays visible for 300ms
    const timer = setTimeout(() => this.enqueue(postId, postData), 300);
    this.pending.set(postId, { timer, abortController: new AbortController() });
  }

  onPostHidden(postId) {
    // Cancel if post scrolls away
    const entry = this.pending.get(postId);
    if (entry) {
      clearTimeout(entry.timer);
      entry.abortController.abort();
      this.pending.delete(postId);
    }
  }

  async enqueue(postId, postData) {
    // Check cache first
    const cached = await cache.get(postId);
    if (cached) { updateBadge(postId, cached); return; }

    // Wait for concurrency slot
    await this.waitForSlot();
    this.active.add(postId);

    // Run pipeline: fast heuristics first, then ML
    const heuristicScore = runHeuristics(postData);
    updateBadge(postId, heuristicScore, { preliminary: true });

    const mlScore = await runMLModel(postData, this.pending.get(postId)?.abortController.signal);
    const finalScore = ensemble(heuristicScore, mlScore);
    updateBadge(postId, finalScore, { preliminary: false });

    await cache.set(postId, finalScore);
    this.active.delete(postId);
  }
}
```

### Expanded Detail Panel (on badge click)
```
┌──────────────────────────────────┐
│  AI Detection Breakdown          │
│──────────────────────────────────│
│  Overall Score: 72% AI           │
│                                  │
│  📝 Text Analysis                │
│  ├─ Statistical:    68% AI       │
│  ├─ Linguistic:     81% AI       │
│  └─ ML Model:       70% AI       │
│                                  │
│  🖼️ Image Analysis               │
│  ├─ Frequency:      85% AI       │
│  ├─ Metadata:       90% AI       │
│  └─ ML Model:       82% AI       │
│                                  │
│  🔍 Key Signals                  │
│  • Uniform sentence lengths      │
│  • AI phrase: "delve into"       │
│  • No EXIF camera data           │
│  • Spectral anomaly detected     │
└──────────────────────────────────┘
```

---

## 2. Text Detection Pipeline

### Layer A — Statistical Analysis (instant, zero-dependency)
| Signal | What it measures | Why it works |
|--------|-----------------|--------------|
| Burstiness | Variance in sentence lengths | Humans vary wildly; AI is uniform |
| Entropy | Character/word n-gram predictability | AI text is more predictable |
| Type-Token Ratio | Vocabulary richness | AI uses "safe" mid-frequency words |
| Sentence starters | Diversity of opening words | AI repeats patterns |
| Punctuation profile | Use of dashes, ellipses, parens | AI underuses these |
| Word length distribution | Spread of short vs long words | AI clusters around averages |

### Layer B — Linguistic Pattern Detection (rule-based)
- **AI phrase database**: "delve into", "it's important to note", "in today's fast-paced world", "I'm thrilled to share", "let's unpack this", "here's the thing", "at the end of the day"
- **LinkedIn-specific patterns**: hook → story → lesson → CTA formula detection
- **Structural analysis**: paragraph count uniformity, bullet point patterns
- **Emoji/hashtag clustering**: AI tends to group these at the end
- **Hedging language density**: "arguably", "it's worth noting", "one might say"

### Layer C — Local ML Model
- **Model**: DistilBERT fine-tuned for binary classification (human vs AI)
- **Runtime**: ONNX Runtime Web (WebAssembly backend)
- **Size**: ~25-60MB (INT8 quantized)
- **Tokenizer**: HuggingFace tokenizers WASM build
- **Training data**: HC3, OpenGPTText, RAID dataset, custom LinkedIn samples

### Ensemble Scoring (Text)
```
text_score = (0.20 × statistical_score) +
             (0.25 × linguistic_score) +
             (0.55 × ml_model_score)
```

---

## 3. Image Detection Pipeline

### Layer A — Metadata Analysis (instant)
| Signal | What it checks | Why it works |
|--------|---------------|--------------|
| EXIF presence | Camera make/model/settings | AI images have no EXIF |
| GPS data | Location coordinates | Real photos often have GPS |
| Software tag | Editing software metadata | AI tools leave signatures (DALL-E, Midjourney) |
| Thumbnail consistency | Embedded thumbnail vs main image | AI images often lack thumbnails |
| Color profile | ICC color profile presence | Camera photos have standard profiles |

### Layer B — Frequency Domain Analysis (lightweight)
- **FFT/DCT analysis**: AI-generated images have distinct spectral fingerprints
  - GAN images show periodic artifacts in frequency domain
  - Diffusion models leave characteristic high-frequency patterns
- Run via **OffscreenCanvas** + typed arrays in the service worker
- Compute 2D FFT on downscaled image (256×256) for speed

### Layer C — Local ML Model
- **Model**: EfficientNet-Lite0 fine-tuned on real vs AI-generated images
- **Size**: ~15-20MB (INT8 quantized ONNX)
- **Input**: 224×224 RGB image
- **Training data**:
  - Real: LSUN, COCO subsets
  - AI: Generated samples from Stable Diffusion, DALL-E (public datasets)
  - Augmented with JPEG compression, resizing (mimics social media processing)
- **Key**: Train on compressed/resized images since LinkedIn reprocesses all uploads

### Image Extraction from LinkedIn
- Detect `<img>` tags within post containers
- Filter out UI elements (avatars, icons, reaction images) by size and CSS class
- Fetch image via `fetch()` from the content script (same-origin)
- For carousel posts: analyze each image independently, report worst score

### Ensemble Scoring (Image)
```
image_score = (0.25 × metadata_score) +
              (0.25 × frequency_score) +
              (0.50 × ml_model_score)
```

---

## 4. Video Detection Pipeline

> Videos are compute-heavy. Analysis runs **on-demand** (user clicks "Analyze Video" button) rather than automatically.

### Layer A — Keyframe Image Analysis
- Extract keyframes using `<video>` element + `canvas.drawImage()` at intervals
- Sample 1 frame every 5 seconds (or at scene changes via pixel-diff threshold)
- Run each keyframe through the **Image Detection Pipeline**
- Aggregate: report max and average AI scores across frames

### Layer B — Audio Analysis (AI Speech Detection)
- Extract audio via **Web Audio API** (`AudioContext`, `AnalyserNode`)
- Signals for AI-generated speech:

| Signal | What it measures | Why it works |
|--------|-----------------|--------------|
| Pitch variance | F0 contour variation | AI speech has unnaturally smooth pitch |
| Pause patterns | Distribution of silences | AI has uniform/no natural hesitations |
| Spectral flatness | Frequency distribution | AI audio has distinct spectral shape |
| Speaking rate | Words per minute variance | AI maintains constant rate |
| Breathing sounds | Presence of breath noise | AI speech lacks natural breathing |

- Use **Meyda.js** (MIT license, runs in browser) for audio feature extraction
- Build a lightweight classifier (small dense network, <1MB) on extracted features

### Layer C — Visual Consistency Checks
- **Temporal coherence**: check for flickering, inconsistent lighting between frames
- **Face consistency**: if faces present, check for morphing artifacts across frames
- **Background stability**: AI videos often have unstable backgrounds

### Video Extraction from LinkedIn
- Detect `<video>` elements within post containers
- LinkedIn uses adaptive streaming — work with the rendered video element
- Use `captureStream()` or frame-by-frame canvas extraction
- Respect autoplay: only analyze when video is loaded/playing

### Ensemble Scoring (Video)
```
video_score = (0.50 × keyframe_image_score) +
              (0.35 × audio_score) +
              (0.15 × visual_consistency_score)
```

---

## 5. Overall Post Score

When a post has multiple content types, combine them:

```
// Text-only post
overall = text_score

// Text + Image post
overall = (0.50 × text_score) + (0.50 × image_score)

// Text + Video post
overall = (0.40 × text_score) + (0.60 × video_score)

// Image-only or Video-only (shared posts, reposts)
overall = media_score
```

Badge shows the **overall score**. Expanded panel shows per-content-type breakdown.

---

## 6. Project Structure

```
ai-content-detector/
├── extension/                    # Chrome extension
│   ├── manifest.json             # Manifest V3
│   ├── content/
│   │   ├── content-script.js     # LinkedIn DOM scraping + badge injection
│   │   ├── badge.js              # Badge component (Shadow DOM)
│   │   ├── detail-panel.js       # Expanded breakdown panel
│   │   └── content.css           # Scoped styles
│   ├── background/
│   │   ├── service-worker.js     # Main orchestrator
│   │   ├── text-detector.js      # Text detection pipeline
│   │   ├── image-detector.js     # Image detection pipeline
│   │   ├── video-detector.js     # Video detection pipeline
│   │   └── ensemble.js           # Score combination
│   ├── popup/
│   │   ├── popup.html            # Extension popup
│   │   ├── popup.js              # Settings, toggle, history
│   │   └── popup.css
│   ├── models/                   # ONNX model files (git-lfs or downloaded on install)
│   │   ├── text-classifier.onnx  # DistilBERT quantized (~50MB)
│   │   ├── image-classifier.onnx # EfficientNet-Lite quantized (~18MB)
│   │   ├── audio-classifier.onnx # Small dense network (<1MB)
│   │   └── tokenizer/            # HuggingFace tokenizer files
│   ├── lib/
│   │   ├── ort.min.js            # ONNX Runtime Web
│   │   ├── meyda.min.js          # Audio feature extraction
│   │   └── fft.js                # FFT implementation
│   └── utils/
│       ├── linkedin-selectors.js # LinkedIn DOM selectors (versioned)
│       ├── cache.js              # IndexedDB result caching
│       └── stats.js              # Statistical helper functions
│
├── training/                     # Model training (Python, not shipped)
│   ├── text/
│   │   ├── train_text_model.py   # Fine-tune DistilBERT
│   │   ├── export_onnx.py        # Export + quantize to ONNX
│   │   └── dataset_prep.py       # Prepare HC3/OpenGPTText data
│   ├── image/
│   │   ├── train_image_model.py  # Fine-tune EfficientNet-Lite
│   │   ├── export_onnx.py
│   │   └── dataset_prep.py
│   ├── audio/
│   │   ├── train_audio_model.py  # Train audio classifier
│   │   └── export_onnx.py
│   └── requirements.txt          # Python dependencies
│
├── tests/                        # Test suite
│   ├── unit/                     # Per-module tests
│   ├── integration/              # Pipeline tests
│   └── fixtures/                 # Sample posts, images, audio
│
├── webpack.config.js             # Build config
├── package.json
└── README.md
```

---

## 7. Implementation Phases

### Phase 1: Extension Scaffold + LinkedIn Scraper + Lazy Evaluation
- [ ] Set up Manifest V3 extension skeleton
- [ ] Implement content script with MutationObserver for LinkedIn feed
- [ ] Build post text extraction (handle "...see more" expansion)
- [ ] Build image URL extraction from posts
- [ ] Build video element detection
- [ ] Inject dormant placeholder badges into post headers via Shadow DOM
- [ ] Implement IntersectionObserver for viewport-based lazy triggering
- [ ] Build AnalysisQueue with concurrency limit (max 2) and debounce (300ms)
- [ ] Implement cancellation (abort analysis when post leaves viewport)
- [ ] Set up IndexedDB cache (keyed by post content hash)
- [ ] Set up message passing between content script ↔ service worker
- [ ] Wire up two-phase badge update: preliminary (heuristic) → final (ML)

### Phase 2: Text Detection (Statistical + Linguistic)
- [ ] Implement burstiness calculator
- [ ] Implement entropy/perplexity estimator
- [ ] Implement type-token ratio calculator
- [ ] Implement sentence starter diversity scorer
- [ ] Implement punctuation profile analyzer
- [ ] Build AI phrase database + pattern matcher
- [ ] Build LinkedIn post structure analyzer (hook/story/lesson/CTA detection)
- [ ] Implement emoji/hashtag clustering detector
- [ ] Create weighted scorer combining all text heuristics
- [ ] Wire up to live badges (heuristics-only mode)

### Phase 3: Image Detection (Metadata + Frequency)
- [ ] Implement EXIF/metadata parser (use built-in or lightweight lib)
- [ ] Build frequency domain analyzer (2D FFT on canvas)
- [ ] Build spectral fingerprint comparison logic
- [ ] Create image scoring pipeline
- [ ] Add image badge next to post images

### Phase 4: ML Model Training (offline, Python)
- [ ] Prepare text training dataset (HC3 + OpenGPTText + LinkedIn samples)
- [ ] Fine-tune DistilBERT for text classification
- [ ] Quantize + export to ONNX
- [ ] Prepare image training dataset (real photos + AI-generated, with social media compression augmentation)
- [ ] Fine-tune EfficientNet-Lite0
- [ ] Quantize + export to ONNX
- [ ] Validate model sizes fit browser constraints

### Phase 5: In-Browser ML Integration
- [ ] Bundle ONNX Runtime Web
- [ ] Load text model in service worker, implement tokenization + inference
- [ ] Load image model, implement image preprocessing + inference
- [ ] Update ensemble scorer to include ML scores
- [ ] Add model lazy-loading (download on first use, cache in IndexedDB)
- [ ] Optimize with Web Workers for non-blocking inference

### Phase 6: Video Detection
- [ ] Implement keyframe extraction from <video> elements
- [ ] Build audio feature extraction pipeline with Meyda.js
- [ ] Train + ship small audio classifier
- [ ] Implement visual consistency checks
- [ ] Add "Analyze Video" button UI
- [ ] Wire up video scoring to badge system

### Phase 7: Polish + Performance
- [ ] Result caching in IndexedDB (keyed by post ID/content hash)
- [ ] Settings page: sensitivity threshold, auto-scan toggle, content type toggles
- [ ] Performance profiling + optimization (batch processing, debouncing)
- [ ] Handle LinkedIn UI updates gracefully (selector versioning)
- [ ] Cross-browser testing
- [ ] Extension store listing preparation

---

## 8. Key Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Extension manifest | V3 | Required for Chrome Web Store, future-proof |
| ML runtime | ONNX Runtime Web | Best browser ML perf, Apache 2.0 license, free |
| Text model | DistilBERT (INT8) | Good accuracy/size tradeoff (~50MB) |
| Image model | EfficientNet-Lite0 (INT8) | Designed for edge devices (~18MB) |
| Audio features | Meyda.js | MIT license, browser-native, lightweight |
| Badge isolation | Shadow DOM | Prevents CSS conflicts with LinkedIn |
| Caching | IndexedDB | Persistent, large storage, async API |
| Build tool | Webpack | Mature, good WASM/worker support |
| Video analysis | On-demand only | Too compute-heavy for auto-scan |

---

## 9. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| LinkedIn DOM changes | Badges break | Selector versioning + fallback selectors + quick-patch release process |
| Model too large | Slow install/load | Lazy-load models on first use, cache in IndexedDB |
| False positives | User trust erodes | Conservative thresholds, show confidence breakdown, let user adjust sensitivity |
| LinkedIn blocks extension | Extension stops working | Use minimal DOM modification, avoid network interception |
| AI writing evolves | Model accuracy degrades | Periodic retraining, heuristic layer adapts faster than ML |
| JPEG compression destroys image signals | Low image accuracy | Train on compressed images, rely on metadata + frequency signals too |
