/**
 * Image Detection Pipeline
 *
 * Layer A — Metadata analysis (EXIF parsing: camera, GPS, software tags, thumbnails)
 * Layer B — Frequency domain analysis (2D FFT spectral fingerprint)
 * Layer C — ML model (EfficientNet-Lite via ONNX Runtime Web)
 */

import { runImageML } from './model-loader.js';

// ─── Layer A: EXIF Metadata Analysis ──────────────────────────────────

// EXIF tag IDs we care about
const EXIF_TAGS = {
  0x010F: 'Make',           // Camera manufacturer
  0x0110: 'Model',          // Camera model
  0x0112: 'Orientation',    // Image orientation
  0x011A: 'XResolution',    // X resolution
  0x0131: 'Software',       // Software used
  0x0132: 'DateTime',       // Date/time taken
  0x8769: 'ExifIFD',        // Pointer to EXIF sub-IFD
  0x8825: 'GPSIFD',         // Pointer to GPS IFD
  0xA001: 'ColorSpace',     // Color space
  0xA002: 'PixelXDimension',
  0xA003: 'PixelYDimension',
  0xA430: 'CameraOwnerName',
  0xA431: 'BodySerialNumber',
  0xA432: 'LensInfo',
  0xA433: 'LensMake',
  0xA434: 'LensModel',
};

// Software tags that indicate AI generation
const AI_SOFTWARE_INDICATORS = [
  'dall-e', 'midjourney', 'stable diffusion', 'stability ai',
  'adobe firefly', 'bing image creator', 'leonardo ai',
  'playground ai', 'nightcafe', 'artbreeder', 'craiyon',
  'ideogram', 'flux', 'comfyui', 'automatic1111',
];

/**
 * Parse EXIF data from a JPEG buffer.
 * Returns structured metadata for scoring.
 */
function parseExif(buffer) {
  const result = {
    hasExif: false,
    hasCameraInfo: false,
    hasGPS: false,
    hasThumbnail: false,
    hasLensInfo: false,
    hasDateTime: false,
    software: null,
    make: null,
    model: null,
    isAISoftware: false,
    tags: {},
  };

  try {
    const view = new DataView(buffer);

    // Check JPEG magic
    if (view.getUint16(0) !== 0xFFD8) return result;

    // Find APP1 marker (EXIF)
    let offset = 2;
    while (offset < Math.min(buffer.byteLength, 65536)) {
      if (view.getUint8(offset) !== 0xFF) break;
      const marker = view.getUint16(offset);

      if (marker === 0xFFE1) {
        // Found APP1
        const segLength = view.getUint16(offset + 2);
        const exifStart = offset + 4;

        // Check "Exif\0\0" header
        const exifHeader = String.fromCharCode(
          view.getUint8(exifStart), view.getUint8(exifStart + 1),
          view.getUint8(exifStart + 2), view.getUint8(exifStart + 3)
        );

        if (exifHeader === 'Exif') {
          result.hasExif = true;
          const tiffStart = exifStart + 6;
          const isLittle = view.getUint16(tiffStart) === 0x4949; // II = little-endian

          // Parse IFD0
          const ifdOffset = view.getUint32(tiffStart + 4, isLittle);
          parseTags(view, tiffStart, tiffStart + ifdOffset, isLittle, result);

          // Check for thumbnail (IFD1)
          const ifd0EntryCount = view.getUint16(tiffStart + ifdOffset, isLittle);
          const ifd1Pointer = tiffStart + ifdOffset + 2 + ifd0EntryCount * 12;
          if (ifd1Pointer + 4 <= buffer.byteLength) {
            const ifd1Offset = view.getUint32(ifd1Pointer, isLittle);
            if (ifd1Offset > 0 && tiffStart + ifd1Offset < buffer.byteLength) {
              result.hasThumbnail = true;
            }
          }
        }
        break;
      }

      // Skip to next marker
      if (marker === 0xFFDA) break; // Start of scan — stop looking
      const segLen = view.getUint16(offset + 2);
      offset += 2 + segLen;
    }

    // Check for PNG tEXt/iTXt chunks (AI tools sometimes embed info here)
    if (view.getUint32(0) === 0x89504E47) { // PNG magic
      parsePngChunks(view, buffer.byteLength, result);
    }
  } catch {
    // Parse errors are non-fatal — just means we can't extract metadata
  }

  return result;
}

function parseTags(view, tiffStart, ifdStart, isLittle, result) {
  try {
    const entryCount = view.getUint16(ifdStart, isLittle);

    for (let i = 0; i < Math.min(entryCount, 50); i++) {
      const entryOffset = ifdStart + 2 + i * 12;
      if (entryOffset + 12 > view.byteLength) break;

      const tag = view.getUint16(entryOffset, isLittle);
      const type = view.getUint16(entryOffset + 2, isLittle);
      const count = view.getUint32(entryOffset + 4, isLittle);

      const tagName = EXIF_TAGS[tag];
      if (!tagName) continue;

      // Read ASCII string values
      if (type === 2 && count < 256) {
        let valueOffset;
        if (count <= 4) {
          valueOffset = entryOffset + 8;
        } else {
          valueOffset = tiffStart + view.getUint32(entryOffset + 8, isLittle);
        }

        if (valueOffset + count <= view.byteLength) {
          let str = '';
          for (let j = 0; j < count - 1; j++) {
            str += String.fromCharCode(view.getUint8(valueOffset + j));
          }
          result.tags[tagName] = str;

          if (tagName === 'Make') { result.make = str; result.hasCameraInfo = true; }
          if (tagName === 'Model') { result.model = str; result.hasCameraInfo = true; }
          if (tagName === 'Software') {
            result.software = str;
            const lower = str.toLowerCase();
            result.isAISoftware = AI_SOFTWARE_INDICATORS.some((ai) => lower.includes(ai));
          }
          if (tagName === 'DateTime') result.hasDateTime = true;
          if (tagName === 'LensMake' || tagName === 'LensModel') result.hasLensInfo = true;
        }
      }

      // Check for GPS and EXIF sub-IFD pointers
      if (tag === 0x8825) result.hasGPS = true;
      if (tagName === 'LensInfo') result.hasLensInfo = true;
    }
  } catch {
    // Non-fatal
  }
}

function parsePngChunks(view, length, result) {
  let offset = 8; // skip PNG magic
  try {
    while (offset + 8 < length) {
      const chunkLen = view.getUint32(offset);
      const chunkType = String.fromCharCode(
        view.getUint8(offset + 4), view.getUint8(offset + 5),
        view.getUint8(offset + 6), view.getUint8(offset + 7)
      );

      if (chunkType === 'tEXt' || chunkType === 'iTXt') {
        // Read text content — look for AI tool signatures
        let textContent = '';
        const textStart = offset + 8;
        for (let i = 0; i < Math.min(chunkLen, 500); i++) {
          textContent += String.fromCharCode(view.getUint8(textStart + i));
        }
        const lower = textContent.toLowerCase();
        if (AI_SOFTWARE_INDICATORS.some((ai) => lower.includes(ai))) {
          result.isAISoftware = true;
          result.software = textContent.slice(0, 100);
        }
        // ComfyUI / Automatic1111 embed generation parameters
        if (lower.includes('parameters') || lower.includes('prompt') || lower.includes('workflow')) {
          result.isAISoftware = true;
          result.tags['GenerationParams'] = 'Detected';
        }
      }

      offset += 12 + chunkLen; // 4 length + 4 type + data + 4 CRC
      if (chunkType === 'IEND') break;
    }
  } catch {
    // Non-fatal
  }
}

/**
 * Score metadata analysis.
 */
function scoreMetadata(meta) {
  const signals = [];
  let score = 50; // Start neutral

  if (meta.isAISoftware) {
    signals.push(`AI tool detected: ${meta.software}`);
    score += 40;
  }

  if (meta.tags['GenerationParams']) {
    signals.push('AI generation parameters embedded');
    score += 35;
  }

  if (!meta.hasExif) {
    signals.push('No EXIF data (common in AI images)');
    score += 15;
  } else {
    if (meta.hasCameraInfo) {
      signals.push(`Camera: ${meta.make} ${meta.model}`);
      score -= 25;
    } else {
      signals.push('EXIF present but no camera info');
      score += 10;
    }

    if (meta.hasGPS) {
      signals.push('GPS coordinates present');
      score -= 15;
    }

    if (meta.hasLensInfo) {
      signals.push('Lens information present');
      score -= 10;
    }

    if (meta.hasDateTime) {
      score -= 5;
    }

    if (meta.hasThumbnail) {
      score -= 5;
    } else {
      signals.push('No embedded thumbnail');
      score += 5;
    }
  }

  return {
    score: clamp(score, 0, 100),
    signals,
  };
}

// ─── Layer B: Frequency Domain Analysis ───────────────────────────────

/**
 * Analyze image in frequency domain using FFT.
 * AI-generated images have distinct spectral fingerprints:
 * - GAN images show periodic artifacts (grid patterns in frequency space)
 * - Diffusion models have characteristic high-frequency rolloff
 *
 * @param {ImageData} imageData - Grayscale image data (downscaled to power-of-2)
 * @param {number} width
 * @param {number} height
 */
function analyzeFrequencyDomain(imageData, width, height) {
  const signals = [];

  // Convert to grayscale float array
  const gray = new Float64Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const r = imageData[i * 4];
    const g = imageData[i * 4 + 1];
    const b = imageData[i * 4 + 2];
    gray[i] = 0.299 * r + 0.587 * g + 0.114 * b;
  }

  // Compute 2D FFT magnitude spectrum
  const spectrum = compute2DFFT(gray, width, height);

  // Analyze spectral features
  let score = 50;

  // 1. Azimuthal average — radial power spectrum
  const radialProfile = computeRadialProfile(spectrum, width, height);

  // Natural images follow a 1/f^α power law (α ≈ 2)
  // AI images deviate, especially GAN images with spectral peaks
  const alphaFit = fitPowerLaw(radialProfile);
  if (alphaFit.alpha < 1.5 || alphaFit.alpha > 2.8) {
    signals.push(`Atypical spectral slope (α=${alphaFit.alpha.toFixed(2)})`);
    score += 15;
  }
  if (alphaFit.residual > 0.3) {
    signals.push('Spectral irregularity detected');
    score += 10;
  }

  // 2. Check for periodic artifacts (GAN grid patterns)
  const peaks = detectSpectralPeaks(spectrum, width, height);
  if (peaks.length > 0) {
    signals.push(`Periodic artifacts detected (${peaks.length} peaks)`);
    score += 20;
  }

  // 3. High-frequency energy ratio
  const hfRatio = computeHighFreqRatio(spectrum, width, height);
  // AI images tend to have less high-frequency detail or unnatural HF patterns
  if (hfRatio < 0.05) {
    signals.push('Unusually low high-frequency detail');
    score += 10;
  } else if (hfRatio > 0.4) {
    signals.push('Unusual high-frequency energy');
    score += 8;
  }

  return {
    score: clamp(score, 0, 100),
    signals,
  };
}

/**
 * Simplified 2D FFT using row-column decomposition.
 * Returns magnitude spectrum (log-scaled).
 */
function compute2DFFT(gray, width, height) {
  // Row-wise FFT
  const rowFFT = new Float64Array(width * height);
  const rowFFTImag = new Float64Array(width * height);

  for (let y = 0; y < height; y++) {
    const realRow = gray.slice(y * width, (y + 1) * width);
    const imagRow = new Float64Array(width);
    fft1D(realRow, imagRow);
    rowFFT.set(realRow, y * width);
    rowFFTImag.set(imagRow, y * width);
  }

  // Column-wise FFT
  const magnitude = new Float64Array(width * height);
  for (let x = 0; x < width; x++) {
    const realCol = new Float64Array(height);
    const imagCol = new Float64Array(height);
    for (let y = 0; y < height; y++) {
      realCol[y] = rowFFT[y * width + x];
      imagCol[y] = rowFFTImag[y * width + x];
    }
    fft1D(realCol, imagCol);
    for (let y = 0; y < height; y++) {
      const mag = Math.sqrt(realCol[y] ** 2 + imagCol[y] ** 2);
      magnitude[y * width + x] = Math.log(1 + mag);
    }
  }

  return magnitude;
}

/**
 * In-place Cooley-Tukey radix-2 FFT.
 */
function fft1D(real, imag) {
  const n = real.length;
  if (n <= 1) return;

  // Bit-reversal permutation
  let j = 0;
  for (let i = 0; i < n; i++) {
    if (j > i) {
      [real[i], real[j]] = [real[j], real[i]];
      [imag[i], imag[j]] = [imag[j], imag[i]];
    }
    let m = n >> 1;
    while (m >= 1 && j >= m) { j -= m; m >>= 1; }
    j += m;
  }

  // FFT butterfly
  for (let step = 2; step <= n; step *= 2) {
    const halfStep = step / 2;
    const angle = -2 * Math.PI / step;
    const wR = Math.cos(angle);
    const wI = Math.sin(angle);

    for (let i = 0; i < n; i += step) {
      let curR = 1, curI = 0;
      for (let k = 0; k < halfStep; k++) {
        const idx1 = i + k;
        const idx2 = i + k + halfStep;
        const tR = curR * real[idx2] - curI * imag[idx2];
        const tI = curR * imag[idx2] + curI * real[idx2];
        real[idx2] = real[idx1] - tR;
        imag[idx2] = imag[idx1] - tI;
        real[idx1] += tR;
        imag[idx1] += tI;
        const newCurR = curR * wR - curI * wI;
        curI = curR * wI + curI * wR;
        curR = newCurR;
      }
    }
  }
}

/**
 * Compute radial average of frequency spectrum (azimuthal average).
 */
function computeRadialProfile(spectrum, width, height) {
  const cx = width / 2;
  const cy = height / 2;
  const maxRadius = Math.min(cx, cy);
  const profile = new Float64Array(maxRadius);
  const counts = new Uint32Array(maxRadius);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Shift to center
      const sx = (x + cx) % width;
      const sy = (y + cy) % height;
      const r = Math.sqrt((sx - cx) ** 2 + (sy - cy) ** 2);
      const ri = Math.floor(r);
      if (ri < maxRadius) {
        profile[ri] += spectrum[y * width + x];
        counts[ri]++;
      }
    }
  }

  for (let i = 0; i < maxRadius; i++) {
    if (counts[i] > 0) profile[i] /= counts[i];
  }

  return profile;
}

/**
 * Fit a power law (1/f^α) to the radial profile.
 * Returns alpha (slope) and residual (goodness of fit).
 */
function fitPowerLaw(profile) {
  // Log-log linear regression on non-zero frequencies
  const xs = [], ys = [];
  for (let i = 2; i < profile.length; i++) {
    if (profile[i] > 0) {
      xs.push(Math.log(i));
      ys.push(Math.log(profile[i]));
    }
  }

  if (xs.length < 10) return { alpha: 2.0, residual: 0 };

  // Simple linear regression
  const n = xs.length;
  const sumX = xs.reduce((a, b) => a + b, 0);
  const sumY = ys.reduce((a, b) => a + b, 0);
  const sumXY = xs.reduce((s, x, i) => s + x * ys[i], 0);
  const sumX2 = xs.reduce((s, x) => s + x * x, 0);

  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;

  // Residual: mean squared error
  const residual = ys.reduce((s, y, i) => {
    const predicted = slope * xs[i] + intercept;
    return s + (y - predicted) ** 2;
  }, 0) / n;

  return { alpha: -slope, residual: Math.sqrt(residual) };
}

/**
 * Detect periodic peaks in the spectrum (GAN artifact signature).
 */
function detectSpectralPeaks(spectrum, width, height) {
  const peaks = [];
  const cx = width / 2;
  const cy = height / 2;

  // Compute local average and look for peaks > 3x the local average
  for (let y = 4; y < height - 4; y += 2) {
    for (let x = 4; x < width - 4; x += 2) {
      const sx = (x + cx) % width;
      const sy = (y + cy) % height;
      const val = spectrum[sy * width + sx];

      // Skip DC component and very low frequencies
      const r = Math.sqrt((sx - cx) ** 2 + (sy - cy) ** 2);
      if (r < 5 || r > Math.min(cx, cy) - 5) continue;

      // Local average (5x5 neighborhood)
      let localSum = 0, localCount = 0;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          if (dx === 0 && dy === 0) continue;
          const ny = ((sy + dy) + height) % height;
          const nx = ((sx + dx) + width) % width;
          localSum += spectrum[ny * width + nx];
          localCount++;
        }
      }
      const localAvg = localSum / localCount;

      if (val > localAvg * 3 && val > 1) {
        peaks.push({ x: sx - cx, y: sy - cy, magnitude: val / localAvg });
      }
    }
  }

  // Filter: true GAN artifacts appear in symmetric pairs
  const symmetricPeaks = peaks.filter((p) =>
    peaks.some((q) =>
      Math.abs(q.x + p.x) < 3 && Math.abs(q.y + p.y) < 3 && p !== q
    )
  );

  return symmetricPeaks.slice(0, 10); // cap at 10
}

/**
 * Compute ratio of high-frequency energy to total energy.
 */
function computeHighFreqRatio(spectrum, width, height) {
  const cx = width / 2;
  const cy = height / 2;
  const maxR = Math.min(cx, cy);
  const hfThreshold = maxR * 0.6;

  let hfEnergy = 0, totalEnergy = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sx = (x + cx) % width;
      const sy = (y + cy) % height;
      const r = Math.sqrt((sx - cx) ** 2 + (sy - cy) ** 2);
      const val = spectrum[y * width + x];
      totalEnergy += val;
      if (r > hfThreshold) hfEnergy += val;
    }
  }

  return totalEnergy > 0 ? hfEnergy / totalEnergy : 0;
}

// ─── Image Processing Helpers ─────────────────────────────────────────

/**
 * Downscale image to target size using canvas.
 * Returns ImageData. Target must be power of 2 for FFT.
 */
async function downscaleImage(buffer, targetSize = 256) {
  // Create bitmap from buffer
  const blob = new Blob([buffer]);
  const bitmap = await createImageBitmap(blob);

  const canvas = new OffscreenCanvas(targetSize, targetSize);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, targetSize, targetSize);
  bitmap.close();

  return ctx.getImageData(0, 0, targetSize, targetSize);
}

// ─── Combined Pipeline ───────────────────────────────────────────────

/**
 * Analyze image(s) for AI content.
 * @param {string[]} imageUrls - URLs to analyze
 * @param {object} options
 * @param {AbortSignal} [options.signal]
 * @returns {object} { score, metadata, frequency, ml, signals }
 */
export async function analyzeImage(imageUrls, { signal } = {}) {
  if (!imageUrls || imageUrls.length === 0) {
    return { score: null, metadata: null, frequency: null, ml: null, signals: [] };
  }

  const allSignals = [];
  const metadataScores = [];
  const frequencyScores = [];
  const mlScores = [];

  for (const url of imageUrls) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    try {
      const response = await fetch(url, { signal });
      const buffer = await response.arrayBuffer();

      // Layer A: Metadata analysis
      const meta = parseExif(buffer);
      const metaResult = scoreMetadata(meta);
      allSignals.push(...metaResult.signals);
      metadataScores.push(metaResult.score);

      // Layer B: Frequency domain analysis
      try {
        const imageData = await downscaleImage(buffer, 256);
        const freqResult = analyzeFrequencyDomain(imageData.data, 256, 256);
        allSignals.push(...freqResult.signals);
        frequencyScores.push(freqResult.score);
      } catch {
        // OffscreenCanvas may not be available in all contexts
        allSignals.push('Frequency analysis unavailable');
      }

      // Layer C: ML model (EfficientNet-Lite via ONNX)
      try {
        const mlScore = await runImageML(buffer, signal);
        if (mlScore != null) {
          mlScores.push(mlScore);
        }
      } catch (err) {
        if (err.name === 'AbortError') throw err;
        // ML unavailable — gracefully degrade
      }
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      allSignals.push(`Failed to analyze image: ${err.message}`);
    }
  }

  // Aggregate scores (worst-case across all images)
  const avgMetadata = metadataScores.length > 0
    ? Math.max(...metadataScores)
    : null;
  const avgFrequency = frequencyScores.length > 0
    ? Math.max(...frequencyScores)
    : null;
  const avgML = mlScores.length > 0
    ? Math.max(...mlScores)
    : null;

  // Weighted combination — weights adapt based on available layers
  let overallScore = null;
  if (avgMetadata != null && avgFrequency != null && avgML != null) {
    // Full pipeline: metadata 25%, frequency 25%, ML 50%
    overallScore = Math.round(avgMetadata * 0.25 + avgFrequency * 0.25 + avgML * 0.50);
  } else if (avgMetadata != null && avgFrequency != null) {
    overallScore = Math.round(avgMetadata * 0.40 + avgFrequency * 0.60);
  } else if (avgMetadata != null && avgML != null) {
    overallScore = Math.round(avgMetadata * 0.30 + avgML * 0.70);
  } else if (avgMetadata != null) {
    overallScore = Math.round(avgMetadata);
  } else if (avgFrequency != null) {
    overallScore = Math.round(avgFrequency);
  } else if (avgML != null) {
    overallScore = Math.round(avgML);
  }

  return {
    score: overallScore,
    metadata: avgMetadata != null ? Math.round(avgMetadata) : null,
    frequency: avgFrequency != null ? Math.round(avgFrequency) : null,
    ml: avgML != null ? Math.round(avgML) : null,
    signals: allSignals,
  };
}

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}
