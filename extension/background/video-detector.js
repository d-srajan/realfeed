/**
 * Video Detection Pipeline (on-demand only)
 *
 * Layer A — Keyframe extraction + image analysis
 * Layer B — Audio analysis (AI speech detection via Meyda.js)
 * Layer C — Visual consistency checks
 *
 * All layers are placeholders for Phase 6.
 * Video analysis is never auto-triggered; requires explicit user click.
 */

/**
 * Analyze a video for AI content.
 * @param {HTMLVideoElement} videoElement
 * @param {object} options
 * @param {AbortSignal} [options.signal]
 * @returns {object} { score, keyframe, audio, consistency, signals }
 */
export async function analyzeVideo(videoElement, { signal } = {}) {
  // TODO: Phase 6 implementation
  // 1. Extract keyframes via canvas.drawImage() at 5s intervals
  // 2. Run each keyframe through image detection pipeline
  // 3. Extract audio via Web Audio API + Meyda.js
  // 4. Analyze pitch variance, pause patterns, spectral flatness
  // 5. Check visual consistency across frames

  return {
    score: null,
    keyframe: null,
    audio: null,
    consistency: null,
    signals: ['Video analysis not yet implemented'],
  };
}
