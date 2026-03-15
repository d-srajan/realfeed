/**
 * Background Service Worker — orchestrates analysis pipeline.
 *
 * Receives messages from content script:
 *   - analyzePost: queue a post for lazy analysis
 *   - cancelAnalysis: cancel pending analysis for a post
 *
 * Sends messages back:
 *   - analysisResult: final or preliminary scores
 */

import { analysisQueue } from './analysis-queue.js';
import { purgeExpired } from '../utils/cache.js';

// ─── Settings ─────────────────────────────────────────────────────────

function loadSettings() {
  chrome.storage.local.get(['sensitivity', 'analyzeText', 'analyzeImages'], (result) => {
    analysisQueue.updateSettings({
      sensitivity: result.sensitivity || 'medium',
      analyzeText: result.analyzeText !== false,
      analyzeImages: result.analyzeImages !== false,
    });
  });
}

// Reload settings when they change
chrome.storage.onChanged.addListener((changes) => {
  if (changes.sensitivity || changes.analyzeText || changes.analyzeImages) {
    loadSettings();
  }
});

// ─── Message Handling ─────────────────────────────────────────────────

/** Send result back to content script, swallowing errors if the tab navigated away. */
function sendResult(tabId, postId, result) {
  chrome.tabs.sendMessage(tabId, { type: 'analysisResult', postId, result }, () => {
    void chrome.runtime.lastError; // suppress "Could not establish connection" noise
  });
}

chrome.runtime.onMessage.addListener((msg, sender) => {
  const tabId = sender.tab?.id;
  if (!tabId) return;

  switch (msg.type) {
    case 'analyzePost':
      analysisQueue.onPostVisible(msg.postId, msg.postData, (postId, result) => {
        sendResult(tabId, postId, result);
      });
      break;

    case 'cancelAnalysis':
      analysisQueue.onPostHidden(msg.postId);
      break;
  }
});

// ─── Startup ──────────────────────────────────────────────────────────

loadSettings();
purgeExpired().catch(() => {});

console.log('[RealFeed] Service worker activated');
