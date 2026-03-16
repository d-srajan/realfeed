/**
 * AnalysisQueue — manages lazy, viewport-driven analysis with:
 *   - Concurrency limit (max 2 parallel analyses)
 *   - Debouncing (300ms — skip posts during fast scrolling)
 *   - Cancellation (abort when post leaves viewport)
 *   - Two-phase scoring (heuristic first, then ML)
 *   - Cache integration (skip if already analyzed)
 */

import * as cache from '../utils/cache.js';
import { analyzeText } from './text-detector.js';
import { analyzeImage } from './image-detector.js';
import { computeEnsemble } from './ensemble.js';

const MAX_CONCURRENT = 2;
const DEBOUNCE_MS = 300;
const HEURISTICS_TIMEOUT_MS = 2500; // heuristics should be fast; bail if not
const ML_TIMEOUT_MS = 4000;         // image fetch / ML timeout before falling back to heuristics

class AnalysisQueue {
  constructor() {
    /** @type {Map<string, {timer: number, abortController: AbortController}>} */
    this.pending = new Map();

    /** @type {Set<string>} */
    this.active = new Set();

    /** @type {Array<{postId: string, postData: object, resolve: Function}>} */
    this.waitQueue = [];

    /** @type {string} */
    this.sensitivity = 'medium';
  }

  /**
   * Update settings from storage.
   */
  updateSettings(settings) {
    if (settings.sensitivity) this.sensitivity = settings.sensitivity;
  }

  /**
   * Called when a post enters the viewport.
   * Starts a debounce timer before queuing analysis.
   * @param {string} postId
   * @param {object} postData - { text, imageUrls, hasVideo }
   * @param {Function} onResult - callback with (postId, result)
   */
  onPostVisible(postId, postData, onResult) {
    // Already analyzed or in progress
    if (this.active.has(postId)) return;

    // Already pending debounce
    if (this.pending.has(postId)) return;

    const abortController = new AbortController();
    const timer = setTimeout(() => {
      this.enqueue(postId, postData, onResult, abortController);
    }, DEBOUNCE_MS);

    this.pending.set(postId, { timer, abortController });
  }

  /**
   * Called when a post leaves the viewport.
   * Cancels pending debounce or in-flight analysis.
   * Also removes the post from the wait queue so its slot is not permanently held.
   * @param {string} postId
   */
  onPostHidden(postId) {
    const entry = this.pending.get(postId);
    if (entry) {
      clearTimeout(entry.timer);
      entry.abortController.abort();
      this.pending.delete(postId);
    }

    // Remove from wait queue and unblock the slot so other posts aren't starved
    const idx = this.waitQueue.findIndex((item) => item.postId === postId);
    if (idx !== -1) {
      const [removed] = this.waitQueue.splice(idx, 1);
      removed.resolve(); // unblock the awaiting promise so the slot is released
    }
  }

  /**
   * Internal: enqueue a post for analysis after debounce.
   */
  async enqueue(postId, postData, onResult, abortController) {
    // Check cache first
    const contentHash = cache.hashContent(postData.text + (postData.imageUrls || []).join(','));
    const cached = await cache.get(contentHash);
    if (cached) {
      this.pending.delete(postId);
      onResult(postId, cached);
      return;
    }

    // Check abort before proceeding
    if (abortController.signal.aborted) {
      this.pending.delete(postId);
      return;
    }

    // Wait for a concurrency slot
    if (this.active.size >= MAX_CONCURRENT) {
      await new Promise((resolve) => {
        this.waitQueue.push({ postId, postData, resolve });
      });
    }

    // Re-check abort after waiting
    if (abortController.signal.aborted) {
      this.pending.delete(postId);
      this.releaseSlot();
      return;
    }

    this.active.add(postId);
    // Pre-initialize so the catch block can always emit a fallback result
    let heuristicResult = { text: null, image: null, overall: 50, signals: [] };

    try {
      // Phase 1: Fast heuristics with hard timeout
      heuristicResult = await Promise.race([
        this.runHeuristics(postData),
        new Promise((resolve) =>
          setTimeout(
            () => resolve({ text: null, image: null, overall: 50, signals: [], timedOut: true }),
            HEURISTICS_TIMEOUT_MS
          )
        ),
      ]);

      if (abortController.signal.aborted) return;

      // Send preliminary score immediately so the badge stops spinning
      onResult(postId, { ...heuristicResult, preliminary: true });

      // Phase 2: ML / image analysis with hard timeout
      // If it times out, heuristic result becomes the final answer
      const mlResult = await Promise.race([
        this.runML(postData, abortController.signal),
        new Promise((resolve) => setTimeout(() => resolve(null), ML_TIMEOUT_MS)),
      ]);

      if (abortController.signal.aborted) return;

      const finalResult = mlResult
        ? computeEnsemble(heuristicResult, mlResult, postData)
        : { ...heuristicResult }; // ML timed out — promote heuristics to final

      await cache.set(contentHash, finalResult);
      onResult(postId, { ...finalResult, preliminary: false });
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error(`[RealFeed] Analysis failed for ${postId}:`, err);
        // Emit whatever we have so the badge never stays stuck spinning
        if (heuristicResult) {
          onResult(postId, { ...heuristicResult, preliminary: false });
        }
      }
    } finally {
      this.active.delete(postId);
      this.pending.delete(postId);
      this.releaseSlot();
    }
  }

  /**
   * Run fast heuristic analysis (statistical + linguistic).
   * Async because analyzeText is async, but ML is disabled so it returns quickly.
   */
  async runHeuristics(postData) {
    const result = { text: null, image: null, overall: 0, signals: [] };

    if (postData.text) {
      result.text = await analyzeText(postData.text, { mlEnabled: false, sensitivity: this.sensitivity });
      result.signals.push(...(result.text.signals || []));
    }

    // Compute preliminary overall from heuristics only
    if (result.text) {
      result.overall = result.text.score;
    }

    return result;
  }

  /**
   * Run ML model inference (async).
   * @param {object} postData
   * @param {AbortSignal} signal
   */
  async runML(postData, signal) {
    const result = { textML: null, imageML: null };

    if (postData.text) {
      result.textML = await analyzeText(postData.text, { mlEnabled: true, sensitivity: this.sensitivity, signal });
    }

    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

    if (postData.imageUrls && postData.imageUrls.length > 0) {
      result.imageML = await analyzeImage(postData.imageUrls, { signal });
    }

    return result;
  }

  /**
   * Release a concurrency slot and unblock the next waiting analysis.
   */
  releaseSlot() {
    if (this.waitQueue.length > 0) {
      const next = this.waitQueue.shift();
      next.resolve();
    }
  }

  /**
   * Cancel all pending and active analyses.
   */
  cancelAll() {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.abortController.abort();
    }
    this.pending.clear();
    this.waitQueue = [];
  }
}

// Singleton
export const analysisQueue = new AnalysisQueue();
