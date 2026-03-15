/**
 * Badge component — injected into LinkedIn post headers.
 * Uses plain DOM elements (no custom elements) to avoid Chrome
 * content-script isolated-world API availability issues.
 *
 * States:
 *   - dormant:     [── AI]  (not yet analyzed)
 *   - analyzing:   [⏳ AI]  (in queue / running)
 *   - preliminary: [~62% AI] (heuristic score, ML pending, dashed border)
 *   - scored:      [72% AI] (final score)
 */

const BADGE_DATA_ATTR = 'data-ai-badge';

// Exported as BADGE_TAG so content-script.js keeps the same import name.
// When used in querySelector it becomes: [data-ai-badge][data-post-id="..."]
export const BADGE_TAG = `[${BADGE_DATA_ATTR}]`;

const COLOR_STYLES = {
  green:  { background: '#e6f9e6', color: '#2d8a2d', borderColor: '#b3e6b3' },
  yellow: { background: '#fff8e6', color: '#b38600', borderColor: '#ffe599' },
  red:    { background: '#fde8e8', color: '#c53030', borderColor: '#f5b3b3' },
};

function getColorBand(score) {
  if (score <= 30) return 'green';
  if (score <= 60) return 'yellow';
  return 'red';
}

/** Inject shared animation + base styles once into the page. */
function ensureStyles() {
  if (document.getElementById('ai-detector-badge-styles')) return;
  const style = document.createElement('style');
  style.id = 'ai-detector-badge-styles';
  style.textContent = `
    @keyframes ai-det-spin {
      to { transform: rotate(360deg); }
    }
    [data-ai-badge] {
      display: inline-flex;
      align-items: center;
      margin-left: 8px;
      vertical-align: middle;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    .ai-badge-inner {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 8px;
      border-radius: 12px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      border: 1px solid transparent;
      user-select: none;
      line-height: 1.4;
      white-space: nowrap;
      transition: transform 0.15s ease, box-shadow 0.15s ease;
    }
    .ai-badge-inner:hover {
      transform: scale(1.05);
      box-shadow: 0 1px 4px rgba(0,0,0,0.15);
    }
    .ai-badge-spinner {
      display: inline-block;
      width: 10px;
      height: 10px;
      border: 2px solid #ccc;
      border-top-color: #888;
      border-radius: 50%;
      animation: ai-det-spin 0.8s linear infinite;
    }
    .ai-badge-label {
      font-size: 9px;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }
  `;
  document.head.appendChild(style);
}

/**
 * Create and return a new badge element (<span>) with state-management methods.
 *
 * Methods added to the element:
 *   .setDormant()
 *   .setAnalyzing()
 *   .setScore(score, { preliminary, breakdown })
 *   .getScore()  → number | null
 *   .isPreliminary()  → boolean
 *   .getBreakdown()  → object | null
 */
export function createBadge() {
  ensureStyles();

  const host = document.createElement('span');
  host.setAttribute(BADGE_DATA_ATTR, '');

  let _state = 'dormant';
  let _score = null;
  let _preliminary = false;
  let _breakdown = null;

  function render() {
    const inner = document.createElement('span');
    inner.className = 'ai-badge-inner';

    switch (_state) {
      case 'dormant': {
        Object.assign(inner.style, {
          background: '#f0f0f0',
          color: '#999',
          borderColor: '#e0e0e0',
          borderStyle: 'solid',
        });
        inner.textContent = '── AI';
        inner.title = 'AI detection pending (scroll into view)';
        break;
      }

      case 'analyzing': {
        Object.assign(inner.style, {
          background: '#f5f5f5',
          color: '#888',
          borderColor: '#e0e0e0',
          borderStyle: 'solid',
        });
        const spinner = document.createElement('span');
        spinner.className = 'ai-badge-spinner';
        inner.appendChild(spinner);
        const txt = document.createElement('span');
        txt.textContent = 'AI';
        inner.appendChild(txt);
        inner.title = 'Analyzing for AI content…';
        break;
      }

      case 'scored': {
        const band = getColorBand(_score);
        const c = COLOR_STYLES[band];
        Object.assign(inner.style, {
          background: c.background,
          color: c.color,
          borderColor: c.borderColor,
          borderStyle: _preliminary ? 'dashed' : 'solid',
          opacity: _preliminary ? '0.8' : '1',
        });
        const prefix = _preliminary ? '~' : '';
        inner.appendChild(document.createTextNode(`${prefix}${_score}% `));
        const label = document.createElement('span');
        label.className = 'ai-badge-label';
        label.textContent = 'AI';
        inner.appendChild(label);
        inner.title = _preliminary
          ? `Preliminary: ~${_score}% likely AI-generated (ML pending)`
          : `${_score}% likely AI-generated`;
        break;
      }
    }

    host.innerHTML = '';
    host.appendChild(inner);
  }

  // Initial render
  render();

  // ── Public API ─────────────────────────────────────────────────────
  host.setDormant = () => {
    _state = 'dormant'; _score = null; _preliminary = false;
    render();
  };

  host.setAnalyzing = () => {
    _state = 'analyzing';
    render();
  };

  host.setScore = (score, { preliminary = false, breakdown = null } = {}) => {
    _state = 'scored';
    _score = Math.round(score);
    _preliminary = preliminary;
    _breakdown = breakdown;
    render();
  };

  host.getScore = () => _score;
  host.isPreliminary = () => _preliminary;
  host.getBreakdown = () => _breakdown;

  return host;
}

/** No-op — kept so content-script.js import doesn't break. */
export function registerBadge() {}
