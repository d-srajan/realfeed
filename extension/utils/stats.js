/**
 * Statistical helper functions for text analysis.
 */

/**
 * Compute mean of an array of numbers.
 */
export function mean(arr) {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

/**
 * Compute standard deviation.
 */
export function stdDev(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  const variance = arr.reduce((sum, val) => sum + (val - m) ** 2, 0) / arr.length;
  return Math.sqrt(variance);
}

/**
 * Compute coefficient of variation (stdDev / mean).
 */
export function coefficientOfVariation(arr) {
  const m = mean(arr);
  if (m === 0) return 0;
  return stdDev(arr) / m;
}

/**
 * Compute Shannon entropy of a string (character-level).
 */
export function shannonEntropy(text) {
  if (text.length === 0) return 0;
  const freq = {};
  for (const ch of text) {
    freq[ch] = (freq[ch] || 0) + 1;
  }
  let entropy = 0;
  for (const ch in freq) {
    const p = freq[ch] / text.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

/**
 * Clamp a value between min and max.
 */
export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
