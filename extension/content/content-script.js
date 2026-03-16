/**
 * Content Script — runs on LinkedIn pages.
 *
 * Responsibilities:
 * 1. Detect posts in the feed (MutationObserver)
 * 2. Inject dormant badges into post headers
 * 3. Trigger lazy analysis when posts enter viewport (IntersectionObserver)
 * 4. Communicate with background service worker for analysis
 * 5. Update badges with scores when results arrive
 */

import { registerBadge, createBadge, BADGE_TAG } from './badge.js';
import { registerPanel, showPanel } from './detail-panel.js';
import {
  getFeedContainer,
  isPostContainer,
  isPromotedPost,
  getPostId,
  getPostHeader,
  extractPostText,
  extractPostImages,
  hasVideo,
  SELECTORS,
  querySelectorAll,
} from '../utils/linkedin-selectors.js';
import { hashContent } from '../utils/cache.js';

// ─── Constants ────────────────────────────────────────────────────────

const PROCESSED_ATTR = 'data-ai-detector-processed';
const VIEWPORT_ROOT_MARGIN = '200px'; // start analyzing slightly before visible

// Reduced from 15s — if SW is killed and never replies, revert badge quickly
const BADGE_STUCK_TIMEOUT_MS = 6_000;

// ─── State ────────────────────────────────────────────────────────────

let intersectionObserver = null;
let mutationObserver = null;
let enabled = true;

/**
 * Tracks fallback timers for badges stuck in "analyzing".
 * @type {Map<string, ReturnType<typeof setTimeout>>}
 */
const badgeAnalyzingTimers = new Map();

// ─── Initialization ──────────────────────────────────────────────────

function init() {
  registerBadge();
  registerPanel();

  chrome.storage.local.get(['enabled'], (result) => {
    enabled = result.enabled !== false;
    if (enabled) startObserving();
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'toggle') {
      enabled = msg.enabled;
      if (enabled) startObserving();
      else stopObserving();
    }
    if (msg.type === 'analysisResult') {
      handleAnalysisResult(msg.postId, msg.result);
    }
  });
}

// ─── Observers ────────────────────────────────────────────────────────

function startObserving() {
  processExistingPosts();
  setupMutationObserver();
  setupIntersectionObserver();
}

function stopObserving() {
  mutationObserver?.disconnect();
  intersectionObserver?.disconnect();
  mutationObserver = null;
  intersectionObserver = null;
}

function setupMutationObserver() {
  if (mutationObserver) return;

  const feedContainer = getFeedContainer() || document.body;

  mutationObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        if (isPostContainer(node)) processPost(node);

        const selectorList = Array.isArray(SELECTORS.postContainer)
          ? SELECTORS.postContainer
          : [SELECTORS.postContainer];
        for (const sel of selectorList) {
          node.querySelectorAll?.(sel).forEach(processPost);
        }
      }
    }
  });

  mutationObserver.observe(feedContainer, { childList: true, subtree: true });
}

function setupIntersectionObserver() {
  if (intersectionObserver) return;

  intersectionObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const postEl = entry.target;
        const postId = getPostId(postEl) || postEl.getAttribute(PROCESSED_ATTR);
        if (!postId) continue;

        if (entry.isIntersecting) onPostVisible(postEl, postId);
        else onPostHidden(postId);
      }
    },
    { rootMargin: VIEWPORT_ROOT_MARGIN, threshold: 0.1 }
  );
}

// ─── Post Processing ─────────────────────────────────────────────────

function processExistingPosts() {
  querySelectorAll(document, SELECTORS.postContainer).forEach(processPost);
}

function processPost(postEl) {
  if (postEl.hasAttribute(PROCESSED_ATTR)) return;

  // Skip promoted/sponsored posts entirely — they're not user-written
  if (isPromotedPost(postEl)) {
    postEl.setAttribute(PROCESSED_ATTR, 'promoted');
    return;
  }

  const postId = getPostId(postEl) ||
    `post-${hashContent(extractPostText(postEl) || String(Date.now()) + Math.random())}`;
  postEl.setAttribute(PROCESSED_ATTR, postId);

  const header = getPostHeader(postEl);
  if (header && !header.querySelector(BADGE_TAG)) {
    // Guard against duplicate injection — only add badge if none exists yet
    const badge = createBadge();
    badge.setAttribute('data-post-id', postId);
    header.appendChild(badge);

    badge.addEventListener('click', () => {
      const score = badge.getScore();
      if (score == null) return;
      showPanel(badge, badge._lastResult || { overall: score, preliminary: badge.isPreliminary() });
    });
  }

  if (intersectionObserver) intersectionObserver.observe(postEl);
}

// ─── Viewport Callbacks ──────────────────────────────────────────────

function onPostVisible(postEl, postId) {
  const badge = getBadgeForPost(postId);

  // Already has a final score — nothing to do
  if (badge && !badge.isPreliminary() && badge.getScore() != null) return;

  const text = extractPostText(postEl);
  const imageUrls = extractPostImages(postEl);
  const hasVid = hasVideo(postEl);

  // If there's genuinely nothing to analyze, stay dormant
  if (!text && imageUrls.length === 0 && !hasVid) return;

  if (badge && badge.getScore() == null) {
    badge.setAnalyzing();

    if (!badgeAnalyzingTimers.has(postId)) {
      const tid = setTimeout(() => {
        badgeAnalyzingTimers.delete(postId);
        const b = getBadgeForPost(postId);
        if (b && b.getScore() == null) b.setDormant();
      }, BADGE_STUCK_TIMEOUT_MS);
      badgeAnalyzingTimers.set(postId, tid);
    }
  }

  chrome.runtime.sendMessage(
    { type: 'analyzePost', postId, postData: { text, imageUrls, hasVideo: hasVid } },
    () => {
      if (chrome.runtime.lastError) {
        clearBadgeTimer(postId);
        const b = getBadgeForPost(postId);
        if (b && b.getScore() == null) b.setDormant();
      }
    }
  );
}

function onPostHidden(postId) {
  clearBadgeTimer(postId);
  chrome.runtime.sendMessage({ type: 'cancelAnalysis', postId });
}

function clearBadgeTimer(postId) {
  const tid = badgeAnalyzingTimers.get(postId);
  if (tid !== undefined) {
    clearTimeout(tid);
    badgeAnalyzingTimers.delete(postId);
  }
}

// ─── Results ─────────────────────────────────────────────────────────

function handleAnalysisResult(postId, result) {
  clearBadgeTimer(postId);

  const badge = getBadgeForPost(postId);
  if (!badge) return;

  badge._lastResult = result;
  badge.setScore(result.overall, {
    preliminary: result.preliminary || false,
    breakdown: result,
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────

function getBadgeForPost(postId) {
  return document.querySelector(`${BADGE_TAG}[data-post-id="${postId}"]`);
}

// ─── Start ───────────────────────────────────────────────────────────

init();
