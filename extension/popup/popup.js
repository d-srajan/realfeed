/**
 * Popup script — controls extension settings and toggle.
 */

const enableToggle = document.getElementById('enableToggle');
const statusDot = document.querySelector('.status-dot');
const statusText = document.getElementById('statusText');
const sensitivity = document.getElementById('sensitivity');
const analyzeText = document.getElementById('analyzeText');
const analyzeImages = document.getElementById('analyzeImages');

// Load saved settings
chrome.storage.local.get(
  ['enabled', 'sensitivity', 'analyzeText', 'analyzeImages'],
  (result) => {
    enableToggle.checked = result.enabled !== false;
    sensitivity.value = result.sensitivity || 'medium';
    analyzeText.checked = result.analyzeText !== false;
    analyzeImages.checked = result.analyzeImages !== false;
    updateStatusDisplay(enableToggle.checked);
  }
);

// Enable/disable toggle
enableToggle.addEventListener('change', () => {
  const isEnabled = enableToggle.checked;
  chrome.storage.local.set({ enabled: isEnabled });
  updateStatusDisplay(isEnabled);

  // Notify content script
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]?.id) {
      chrome.tabs.sendMessage(tabs[0].id, { type: 'toggle', enabled: isEnabled });
    }
  });
});

// Sensitivity
sensitivity.addEventListener('change', () => {
  chrome.storage.local.set({ sensitivity: sensitivity.value });
});

// Content type toggles
analyzeText.addEventListener('change', () => {
  chrome.storage.local.set({ analyzeText: analyzeText.checked });
});

analyzeImages.addEventListener('change', () => {
  chrome.storage.local.set({ analyzeImages: analyzeImages.checked });
});

function updateStatusDisplay(isEnabled) {
  if (isEnabled) {
    statusDot.className = 'status-dot status-dot--active';
    statusText.textContent = 'Active — scanning visible posts';
  } else {
    statusDot.className = 'status-dot status-dot--inactive';
    statusText.textContent = 'Paused — no posts being scanned';
  }
}
