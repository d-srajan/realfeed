/**
 * Detail Panel — expands on badge click to show per-signal score breakdown.
 * Uses plain DOM elements (no custom elements) to avoid Chrome
 * content-script isolated-world API availability issues.
 */

const PANEL_DATA_ATTR = 'data-ai-panel';

// Exported as PANEL_TAG so content-script.js import keeps working.
export const PANEL_TAG = `[${PANEL_DATA_ATTR}]`;

const PANEL_STYLE_ID = 'ai-detector-panel-styles';

function ensureStyles() {
  if (document.getElementById(PANEL_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = PANEL_STYLE_ID;
  style.textContent = `
    [data-ai-panel] {
      display: block;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      margin-top: 8px;
    }
    .ai-panel-box {
      background: #fff;
      border: 1px solid #e0e0e0;
      border-radius: 8px;
      padding: 12px 16px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      font-size: 13px;
      color: #333;
      max-width: 320px;
    }
    .ai-panel-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 10px;
      padding-bottom: 8px;
      border-bottom: 1px solid #eee;
    }
    .ai-panel-title {
      font-weight: 700;
      font-size: 13px;
      color: #222;
    }
    .ai-panel-overall { font-weight: 700; font-size: 14px; }
    .ai-panel-overall--green  { color: #2d8a2d; }
    .ai-panel-overall--yellow { color: #b38600; }
    .ai-panel-overall--red    { color: #c53030; }
    .ai-panel-section { margin-bottom: 8px; }
    .ai-panel-section-title {
      font-weight: 600;
      font-size: 12px;
      color: #555;
      margin-bottom: 4px;
    }
    .ai-panel-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 2px 0 2px 12px;
      font-size: 12px;
      color: #666;
    }
    .ai-bar-bg {
      width: 60px; height: 6px;
      background: #eee;
      border-radius: 3px;
      overflow: hidden;
      margin-left: 8px;
    }
    .ai-bar-fill {
      height: 100%;
      border-radius: 3px;
    }
    .ai-fill-green  { background: #4caf50; }
    .ai-fill-yellow { background: #ff9800; }
    .ai-fill-red    { background: #f44336; }
    .ai-panel-signals {
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px solid #eee;
    }
    .ai-signal-tag {
      display: inline-block;
      background: #f5f5f5;
      border: 1px solid #e0e0e0;
      border-radius: 4px;
      padding: 2px 6px;
      font-size: 11px;
      color: #666;
      margin: 2px 4px 2px 0;
    }
    .ai-panel-close {
      background: none;
      border: none;
      font-size: 16px;
      cursor: pointer;
      color: #999;
      padding: 0 0 0 8px;
      line-height: 1;
    }
    .ai-panel-close:hover { color: #333; }
    .ai-panel-preliminary {
      font-size: 11px;
      color: #999;
      font-style: italic;
      margin-top: 6px;
    }
  `;
  document.head.appendChild(style);
}

function getColorBand(score) {
  if (score <= 30) return 'green';
  if (score <= 60) return 'yellow';
  return 'red';
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function buildSection(title, rows) {
  const validRows = rows.filter(([, v]) => v != null);
  if (!validRows.length) return null;

  const section = document.createElement('div');
  section.className = 'ai-panel-section';

  const secTitle = document.createElement('div');
  secTitle.className = 'ai-panel-section-title';
  secTitle.textContent = title;
  section.appendChild(secTitle);

  for (const [label, value] of validRows) {
    const rounded = Math.round(value);
    const band = getColorBand(rounded);

    const row = document.createElement('div');
    row.className = 'ai-panel-row';

    const labelSpan = document.createElement('span');
    labelSpan.textContent = `${label}: ${rounded}%`;

    const barBg = document.createElement('div');
    barBg.className = 'ai-bar-bg';
    const barFill = document.createElement('div');
    barFill.className = `ai-bar-fill ai-fill-${band}`;
    barFill.style.width = `${rounded}%`;
    barBg.appendChild(barFill);

    row.appendChild(labelSpan);
    row.appendChild(barBg);
    section.appendChild(row);
  }

  return section;
}

/**
 * Create a detail panel element (<div>) with a .setData(data) method.
 */
export function createPanel() {
  ensureStyles();
  const host = document.createElement('div');
  host.setAttribute(PANEL_DATA_ATTR, '');

  host.setData = function (data) {
    const { overall, preliminary, text, image, video, signals } = data;
    const band = getColorBand(overall);

    host.innerHTML = '';
    const box = document.createElement('div');
    box.className = 'ai-panel-box';

    // Header
    const header = document.createElement('div');
    header.className = 'ai-panel-header';

    const titleEl = document.createElement('span');
    titleEl.className = 'ai-panel-title';
    titleEl.textContent = 'AI Detection Breakdown';

    const scoreEl = document.createElement('span');
    scoreEl.className = `ai-panel-overall ai-panel-overall--${band}`;
    scoreEl.textContent = `${overall}% AI`;

    const closeBtn = document.createElement('button');
    closeBtn.className = 'ai-panel-close';
    closeBtn.title = 'Close';
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', () => host.remove());

    header.appendChild(titleEl);
    header.appendChild(scoreEl);
    header.appendChild(closeBtn);
    box.appendChild(header);

    // Sections
    const sections = [
      text  && buildSection('Text Analysis',  [['Statistical', text.statistical],  ['Linguistic', text.linguistic],   ['ML Model', text.ml]]),
      image && buildSection('Image Analysis', [['Metadata',    image.metadata],     ['Frequency',  image.frequency],   ['ML Model', image.ml]]),
      video && buildSection('Video Analysis', [['Keyframes',   video.keyframe],     ['Audio',       video.audio],      ['Consistency', video.consistency]]),
    ];
    for (const sec of sections) {
      if (sec) box.appendChild(sec);
    }

    // Key signals
    if (signals && signals.length > 0) {
      const sigSection = document.createElement('div');
      sigSection.className = 'ai-panel-signals';
      const sigTitle = document.createElement('div');
      sigTitle.className = 'ai-panel-section-title';
      sigTitle.textContent = 'Key Signals';
      sigSection.appendChild(sigTitle);
      for (const s of signals) {
        const tag = document.createElement('span');
        tag.className = 'ai-signal-tag';
        tag.textContent = s;
        sigSection.appendChild(tag);
      }
      box.appendChild(sigSection);
    }

    // Preliminary note
    if (preliminary) {
      const note = document.createElement('div');
      note.className = 'ai-panel-preliminary';
      note.textContent = 'Preliminary score — ML analysis in progress';
      box.appendChild(note);
    }

    host.appendChild(box);
  };

  return host;
}

/** No-op — kept so content-script.js import doesn't break. */
export function registerPanel() {}

/**
 * Show (or toggle off) the detail panel anchored to a badge element.
 */
export function showPanel(anchorEl, data) {
  // Toggle off if already open
  const existing = anchorEl.parentElement?.querySelector(PANEL_TAG);
  if (existing) {
    existing.remove();
    return;
  }

  const panel = createPanel();
  anchorEl.parentElement.appendChild(panel);
  panel.setData(data);
  return panel;
}
