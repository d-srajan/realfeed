/**
 * Content Script — runs on LinkedIn pages.
 *
 * Responsibilities:
 * 1. Detect posts in the feed (MutationObserver)
 * 2. Inject dormant badges into post headers (Shadow DOM)
 * 3. Trigger lazy analysis when posts enter viewport (IntersectionObserver)
 * 4. Communicate with background service worker for analysis
 * 5. Update badges with scores when results arrive
 */

import { registerBadge, createBadge, BADGE_TAG } from './badge.js';
import { registerPanel, showPanel } from './detail-panel.js';
import {
  getFeedContainer,
  isPostContainer,
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

// ─── State ────────────────────────────────────────────────────────────

let intersectionObserver = null;
let mutationObserver = null;
let enabled = true;

// ─── Initialization ──────────────────────────────────────────────────

function init() {
  // Register custom elements
  registerBadge();
  registerPanel();

  // Check if extension is enabled
  chrome.storage.local.get(['enabled'], (result) => {
    enabled = result.enabled !== false; // default to true
    if (enabled) {
      startObserving();
    }
  });

  // Listen for enable/disable toggle from popup
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'toggle') {
      enabled = msg.enabled;
      if (enabled) {
        startObserving();
      } else {
        stopObserving();
      }
    }
  });

  // Listen for analysis results from background
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'analysisResult') {
      handleAnalysisResult(msg.postId, msg.result);
    }
  });
}

// ─── Observers ────────────────────────────────────────────────────────

function startObserving() {
  // Process any posts already in the DOM
  processExistingPosts();

  // Watch for new posts added to the feed
  setupMutationObserver();

  // Watch for posts entering/leaving the viewport
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

        // Check if the added node is a post container
        if (isPostContainer(node)) {
          processPost(node);
        }

        // Check children for post containers
        const selectorList = Array.isArray(SELECTORS.postContainer)
          ? SELECTORS.postContainer
          : [SELECTORS.postContainer];
        for (const sel of selectorList) {
          const posts = node.querySelectorAll?.(sel) || [];
          posts.forEach(processPost);
        }
      }
    }
  });

  mutationObserver.observe(feedContainer, {
    childList: true,
    subtree: true,
  });
}

function setupIntersectionObserver() {
  if (intersectionObserver) return;

  intersectionObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const postEl = entry.target;
        const postId = getPostId(postEl) || postEl.getAttribute(PROCESSED_ATTR);

        if (!postId) continue;

        if (entry.isIntersecting) {
          onPostVisible(postEl, postId);
        } else {
          onPostHidden(postId);
        }
      }
    },
    {
      rootMargin: VIEWPORT_ROOT_MARGIN,
      threshold: 0.1,
    }
  );
}

// ─── Post Processing ─────────────────────────────────────────────────

function processExistingPosts() {
  const posts = querySelectorAll(document, SELECTORS.postContainer);
  posts.forEach(processPost);
}

function processPost(postEl) {
  // Skip if already processed
  if (postEl.hasAttribute(PROCESSED_ATTR)) return;

  const postId = getPostId(postEl) || `post-${hashContent(extractPostText(postEl) || String(Date.now()))}`;
  postEl.setAttribute(PROCESSED_ATTR, postId);

  // Inject dormant badge
  const header = getPostHeader(postEl);
  if (header) {
    const badge = createBadge();
    badge.setAttribute('data-post-id', postId);
    header.appendChild(badge);

    // Badge click → toggle detail panel
    badge.addEventListener('click', () => {
      const score = badge.getScore();
      if (score == null) return; // no data yet

      showPanel(badge, badge._lastResult || {
        overall: score,
        preliminary: badge.isPreliminary(),
      });
    });
  }

  // Register with IntersectionObserver for lazy evaluation
  if (intersectionObserver) {
    intersectionObserver.observe(postEl);
  }
}

// ─── Viewport Callbacks ──────────────────────────────────────────────

function onPostVisible(postEl, postId) {
  // Extract content
  const text = extractPostText(postEl);
  const imageUrls = extractPostImages(postEl);
  const hasVid = hasVideo(postEl);

  // Update badge to "analyzing" state
  const badge = getBadgeForPost(postId);
  if (badge && badge.getScore() == null) {
    badge.setAnalyzing();
  }

  // Send to background for analysis
  chrome.runtime.sendMessage({
    type: 'analyzePost',
    postId,
    postData: {
      text,
      imageUrls,
      hasVideo: hasVid,
    },
  });
}

function onPostHidden(postId) {
  // Tell background to cancel if still pending
  chrome.runtime.sendMessage({
    type: 'cancelAnalysis',
    postId,
  });
}

// ─── Results ─────────────────────────────────────────────────────────

function handleAnalysisResult(postId, result) {
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
