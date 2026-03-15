/**
 * ONNX Model Loader — handles lazy loading, caching, and inference for ML models.
 *
 * Models are loaded on first use and cached in memory for subsequent calls.
 * Uses ONNX Runtime Web (WebAssembly backend) for in-browser inference.
 *
 * Expected model files in extension/models/:
 *   - text-classifier.onnx    (~50MB, DistilBERT INT8 quantized)
 *   - image-classifier.onnx   (~18MB, EfficientNet-Lite0 INT8 quantized)
 *   - tokenizer.json           (HuggingFace tokenizer config)
 */

let ort = null;

/** @type {Map<string, import('onnxruntime-web').InferenceSession>} */
const sessionCache = new Map();

/** @type {object|null} */
let tokenizerConfig = null;

/** @type {Map<string, number>} */
let vocabMap = null;

// ─── ONNX Runtime Initialization ──────────────────────────────────────

/**
 * Lazily import and configure ONNX Runtime Web.
 */
async function getOrt() {
  if (ort) return ort;
  try {
    ort = await import('onnxruntime-web');
    // Configure WASM paths — these get copied to dist/ by webpack
    ort.env.wasm.wasmPaths = chrome.runtime.getURL('lib/');
    // Use WASM backend (most compatible)
    ort.env.wasm.numThreads = 1; // service workers are single-threaded
    return ort;
  } catch (err) {
    console.warn('[AI Detector] ONNX Runtime not available:', err.message);
    return null;
  }
}

// ─── Session Management ───────────────────────────────────────────────

/**
 * Load an ONNX model session, with caching.
 * @param {string} modelName - e.g., 'text-classifier' or 'image-classifier'
 * @returns {import('onnxruntime-web').InferenceSession|null}
 */
async function loadSession(modelName) {
  if (sessionCache.has(modelName)) {
    return sessionCache.get(modelName);
  }

  const ortModule = await getOrt();
  if (!ortModule) return null;

  try {
    const modelUrl = chrome.runtime.getURL(`models/${modelName}.onnx`);
    const response = await fetch(modelUrl);

    if (!response.ok) {
      console.warn(`[AI Detector] Model ${modelName} not found (${response.status}). ML scoring disabled.`);
      return null;
    }

    const modelBuffer = await response.arrayBuffer();

    const session = await ortModule.InferenceSession.create(modelBuffer, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    });

    sessionCache.set(modelName, session);
    console.log(`[AI Detector] Loaded model: ${modelName}`);
    return session;
  } catch (err) {
    console.warn(`[AI Detector] Failed to load model ${modelName}:`, err.message);
    return null;
  }
}

// ─── Tokenizer ────────────────────────────────────────────────────────

/**
 * Load the tokenizer vocabulary and config.
 * Expects a tokenizer.json file in HuggingFace format.
 */
async function loadTokenizer() {
  if (vocabMap) return;

  try {
    const url = chrome.runtime.getURL('models/tokenizer.json');
    const response = await fetch(url);

    if (!response.ok) {
      console.warn('[AI Detector] Tokenizer not found. Using fallback tokenization.');
      return;
    }

    tokenizerConfig = await response.json();

    // Build vocabulary map from tokenizer model
    vocabMap = new Map();
    if (tokenizerConfig.model?.vocab) {
      // WordPiece/BPE format: { "token": id, ... }
      for (const [token, id] of Object.entries(tokenizerConfig.model.vocab)) {
        vocabMap.set(token, id);
      }
    }

    console.log(`[AI Detector] Tokenizer loaded (${vocabMap.size} tokens)`);
  } catch (err) {
    console.warn('[AI Detector] Tokenizer load failed:', err.message);
  }
}

/**
 * Tokenize text using the loaded vocabulary.
 * Simplified WordPiece tokenization for DistilBERT.
 * @param {string} text
 * @param {number} maxLength - Max sequence length (default 128 for LinkedIn posts)
 * @returns {{ inputIds: number[], attentionMask: number[] }}
 */
function tokenize(text, maxLength = 128) {
  // CLS and SEP token IDs (standard BERT)
  const CLS = vocabMap?.get('[CLS]') ?? 101;
  const SEP = vocabMap?.get('[SEP]') ?? 102;
  const PAD = vocabMap?.get('[PAD]') ?? 0;
  const UNK = vocabMap?.get('[UNK]') ?? 100;

  const inputIds = [CLS];

  if (vocabMap && vocabMap.size > 0) {
    // WordPiece tokenization
    const words = text.toLowerCase().split(/\s+/).filter((w) => w.length > 0);

    for (const word of words) {
      if (inputIds.length >= maxLength - 1) break;

      // Try full word first
      const cleanWord = word.replace(/[^a-z0-9']/g, '');
      if (!cleanWord) continue;

      let matched = false;

      if (vocabMap.has(cleanWord)) {
        inputIds.push(vocabMap.get(cleanWord));
        matched = true;
      } else {
        // WordPiece: try breaking into subwords
        let start = 0;
        let subwordFound = true;

        while (start < cleanWord.length && inputIds.length < maxLength - 1) {
          let end = cleanWord.length;
          let foundSubword = false;

          while (end > start) {
            const sub = start === 0 ? cleanWord.slice(start, end) : `##${cleanWord.slice(start, end)}`;

            if (vocabMap.has(sub)) {
              inputIds.push(vocabMap.get(sub));
              start = end;
              foundSubword = true;
              break;
            }
            end--;
          }

          if (!foundSubword) {
            // Character not in vocab — use UNK for remaining
            if (!matched) inputIds.push(UNK);
            subwordFound = false;
            break;
          }
          matched = true;
        }
      }

      if (!matched) {
        inputIds.push(UNK);
      }
    }
  } else {
    // Fallback: character-level hash tokenization
    // This is a degraded mode when tokenizer.json is not available
    const words = text.toLowerCase().split(/\s+/).filter((w) => w.length > 0);
    for (const word of words) {
      if (inputIds.length >= maxLength - 1) break;
      // Simple hash to vocab range (1000-30000)
      let hash = 0;
      for (const ch of word) hash = ((hash << 5) - hash + ch.charCodeAt(0)) | 0;
      inputIds.push(1000 + Math.abs(hash) % 29000);
    }
  }

  inputIds.push(SEP);

  // Pad to maxLength
  const attentionMask = inputIds.map(() => 1);
  while (inputIds.length < maxLength) {
    inputIds.push(PAD);
    attentionMask.push(0);
  }

  // Truncate if somehow over
  return {
    inputIds: inputIds.slice(0, maxLength),
    attentionMask: attentionMask.slice(0, maxLength),
  };
}

// ─── Text ML Inference ────────────────────────────────────────────────

/**
 * Run text classification using DistilBERT ONNX model.
 * @param {string} text
 * @param {AbortSignal} [signal]
 * @returns {number|null} Score 0-100 (AI probability), or null if model unavailable
 */
export async function runTextML(text, signal) {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  const session = await loadSession('text-classifier');
  if (!session) return null;

  await loadTokenizer();

  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  const { inputIds, attentionMask } = tokenize(text, 128);

  const ortModule = await getOrt();
  if (!ortModule) return null;

  // Create input tensors
  const inputIdsTensor = new ortModule.Tensor('int64',
    BigInt64Array.from(inputIds.map(BigInt)),
    [1, inputIds.length]
  );
  const attentionMaskTensor = new ortModule.Tensor('int64',
    BigInt64Array.from(attentionMask.map(BigInt)),
    [1, attentionMask.length]
  );

  try {
    const feeds = {
      input_ids: inputIdsTensor,
      attention_mask: attentionMaskTensor,
    };

    const results = await session.run(feeds);

    // Get logits from output — model outputs [batch, 2] (human, AI)
    const outputName = session.outputNames[0];
    const logits = results[outputName].data;

    // Apply softmax to get probabilities
    const expHuman = Math.exp(Number(logits[0]));
    const expAI = Math.exp(Number(logits[1]));
    const aiProb = expAI / (expHuman + expAI);

    return Math.round(aiProb * 100);
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    console.warn('[AI Detector] Text ML inference failed:', err.message);
    return null;
  }
}

// ─── Image ML Inference ───────────────────────────────────────────────

/**
 * Run image classification using EfficientNet-Lite ONNX model.
 * @param {ArrayBuffer} imageBuffer - Raw image data
 * @param {AbortSignal} [signal]
 * @returns {number|null} Score 0-100 (AI probability), or null if model unavailable
 */
export async function runImageML(imageBuffer, signal) {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  const session = await loadSession('image-classifier');
  if (!session) return null;

  const ortModule = await getOrt();
  if (!ortModule) return null;

  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  try {
    // Preprocess: resize to 224x224 and normalize
    const imageData = await preprocessImage(imageBuffer, 224);

    // Create input tensor [1, 3, 224, 224] (NCHW format)
    const inputTensor = new ortModule.Tensor('float32', imageData, [1, 3, 224, 224]);

    const feeds = {};
    feeds[session.inputNames[0]] = inputTensor;

    const results = await session.run(feeds);

    // Get output — model outputs [batch, 2] (real, AI)
    const outputName = session.outputNames[0];
    const logits = results[outputName].data;

    // Apply softmax
    const expReal = Math.exp(Number(logits[0]));
    const expAI = Math.exp(Number(logits[1]));
    const aiProb = expAI / (expReal + expAI);

    return Math.round(aiProb * 100);
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    console.warn('[AI Detector] Image ML inference failed:', err.message);
    return null;
  }
}

/**
 * Preprocess image for EfficientNet-Lite: resize to targetSize, normalize to [0,1],
 * output as Float32Array in NCHW format [3, H, W].
 */
async function preprocessImage(buffer, targetSize) {
  const blob = new Blob([buffer]);
  const bitmap = await createImageBitmap(blob);

  const canvas = new OffscreenCanvas(targetSize, targetSize);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, targetSize, targetSize);
  bitmap.close();

  const imageData = ctx.getImageData(0, 0, targetSize, targetSize);
  const pixels = imageData.data; // RGBA, HWC

  // Convert to CHW float32, normalized to [0, 1]
  const channels = 3;
  const totalPixels = targetSize * targetSize;
  const float32Data = new Float32Array(channels * totalPixels);

  for (let i = 0; i < totalPixels; i++) {
    float32Data[i] = pixels[i * 4] / 255.0;                         // R
    float32Data[totalPixels + i] = pixels[i * 4 + 1] / 255.0;       // G
    float32Data[2 * totalPixels + i] = pixels[i * 4 + 2] / 255.0;   // B
  }

  return float32Data;
}

// ─── Model Availability Check ─────────────────────────────────────────

/**
 * Check if a model file exists (non-blocking).
 * @param {string} modelName
 * @returns {boolean}
 */
export async function isModelAvailable(modelName) {
  try {
    const url = chrome.runtime.getURL(`models/${modelName}.onnx`);
    const response = await fetch(url, { method: 'HEAD' });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Get the status of all models.
 */
export async function getModelStatus() {
  const [textAvailable, imageAvailable] = await Promise.all([
    isModelAvailable('text-classifier'),
    isModelAvailable('image-classifier'),
  ]);

  return {
    textModel: {
      available: textAvailable,
      loaded: sessionCache.has('text-classifier'),
    },
    imageModel: {
      available: imageAvailable,
      loaded: sessionCache.has('image-classifier'),
    },
    tokenizerLoaded: vocabMap !== null,
  };
}
