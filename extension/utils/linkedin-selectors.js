/**
 * LinkedIn DOM selectors — versioned and centralized.
 * When LinkedIn updates their DOM, only this file needs to change.
 */

const SELECTORS = {
  // Feed container — LinkedIn uses randomized class names on <main>,
  // so we just match the tag
  feedContainer: 'main',

  // Individual post wrappers
  postContainer: [
    'div.feed-shared-update-v2',
    'div[data-urn^="urn:li:activity"]',
  ],

  // Post header (where badge gets injected)
  postHeader: [
    '.update-components-actor__container',
    '.update-components-actor__meta',
    '.feed-shared-actor',
  ],

  // Post text content
  postText: [
    '.feed-shared-update-v2__description',
    '.feed-shared-text',
    '.update-components-text',
    'span.break-words',
  ],

  // "See more" button for expanding truncated posts
  seeMoreButton: [
    'button.feed-shared-inline-show-more-text__see-more-less-toggle',
    'button[aria-label="see more"]',
  ],

  // Images within posts
  postImage: [
    '.feed-shared-image__image',
    '.update-components-image__image',
    'img[data-delayed-url]',
  ],

  // Video elements within posts
  postVideo: [
    'video.vjs-tech',
    'video[data-sources]',
    '.feed-shared-linkedin-video',
  ],

  // Carousel / multi-image posts
  carousel: '.feed-shared-carousel',

  // Post unique identifier attribute
  postIdAttribute: 'data-urn',
};

/**
 * Try multiple selectors and return the first match.
 * @param {Element} root - Parent element to search within
 * @param {string|string[]} selectors - Single selector or array of fallbacks
 * @returns {Element|null}
 */
export function querySelector(root, selectors) {
  const selectorList = Array.isArray(selectors) ? selectors : [selectors];
  for (const sel of selectorList) {
    const el = root.querySelector(sel);
    if (el) return el;
  }
  return null;
}

/**
 * Try multiple selectors and return all matches.
 * @param {Element} root
 * @param {string|string[]} selectors
 * @returns {Element[]}
 */
export function querySelectorAll(root, selectors) {
  const selectorList = Array.isArray(selectors) ? selectors : [selectors];
  for (const sel of selectorList) {
    const els = root.querySelectorAll(sel);
    if (els.length > 0) return Array.from(els);
  }
  return [];
}

/**
 * Get the feed container element.
 */
export function getFeedContainer() {
  return document.querySelector(SELECTORS.feedContainer);
}

/**
 * Check if an element is a LinkedIn post container.
 */
export function isPostContainer(el) {
  const selectorList = Array.isArray(SELECTORS.postContainer)
    ? SELECTORS.postContainer
    : [SELECTORS.postContainer];
  return selectorList.some((sel) => el.matches?.(sel));
}

/**
 * Extract a unique ID for a post element.
 */
export function getPostId(postEl) {
  return postEl.getAttribute(SELECTORS.postIdAttribute) || null;
}

/**
 * Extract text content from a post.
 * Handles truncated posts by looking for the full text.
 */
export function extractPostText(postEl) {
  const textEl = querySelector(postEl, SELECTORS.postText);
  if (!textEl) return '';
  return textEl.innerText.trim();
}

/**
 * Extract image URLs from a post.
 * Filters out avatars and UI icons by size.
 */
export function extractPostImages(postEl) {
  const images = querySelectorAll(postEl, SELECTORS.postImage);
  return images
    .filter((img) => {
      const w = img.naturalWidth || img.width;
      const h = img.naturalHeight || img.height;
      return w > 100 && h > 100; // skip small icons/avatars
    })
    .map((img) => img.src || img.getAttribute('data-delayed-url'))
    .filter(Boolean);
}

/**
 * Detect if post contains a video element.
 */
export function hasVideo(postEl) {
  return querySelector(postEl, SELECTORS.postVideo) !== null;
}

/**
 * Get the video element from a post.
 */
export function getVideoElement(postEl) {
  return querySelector(postEl, SELECTORS.postVideo);
}

/**
 * Return true if a post is a promoted/sponsored ad.
 * Ads should not receive AI scores — we skip badge injection for them.
 */
export function isPromotedPost(postEl) {
  // LinkedIn marks promoted posts with a "Promoted" label in the actor meta
  const text = postEl.querySelector(
    '.update-components-actor__sub-description, .feed-shared-actor__sub-description'
  )?.textContent ?? '';
  return /\bPromoted\b/i.test(text);
}

/**
 * Get the post header element where the badge will be injected.
 */
export function getPostHeader(postEl) {
  return querySelector(postEl, SELECTORS.postHeader);
}

/**
 * Find all post containers currently in the DOM.
 */
export function getAllPosts() {
  return querySelectorAll(document, SELECTORS.postContainer);
}

export { SELECTORS };
