/**
 * Text Detection Pipeline
 *
 * Layer A — Statistical analysis (burstiness, entropy, TTR, perplexity proxy, etc.)
 * Layer B — Linguistic pattern detection (AI phrases, structure, hedging, transitions, readability)
 * Layer C — ML model (DistilBERT via ONNX Runtime Web)
 */

import { runTextML } from './model-loader.js';

// ─── AI Phrase Database ───────────────────────────────────────────────

const AI_PHRASES = [
  // Generic AI-isms
  'delve into', 'delve deeper', 'it\'s important to note', 'it\'s worth noting',
  'it\'s worth mentioning', 'in today\'s fast-paced', 'in an ever-changing',
  'in the rapidly evolving', 'in this day and age', 'let me be clear',
  'at the end of the day', 'when it comes to', 'in the realm of',
  'at its core', 'in the world of',
  // Buzzwords
  'game-changer', 'paradigm shift', 'synergy', 'leverage', 'robust',
  'streamline', 'cutting-edge', 'groundbreaking', 'transformative',
  'holistic approach', 'actionable insights', 'best practices',
  'thought leader', 'value proposition', 'mission-critical',
  'next-level', 'world-class',
  // LinkedIn AI-isms
  'I\'m thrilled to', 'I\'m excited to share', 'I\'m humbled to',
  'I\'m honored to', 'I\'m delighted to', 'I\'m grateful for',
  'let\'s unpack', 'here\'s the thing', 'here\'s why this matters',
  'let that sink in', 'the bottom line is', 'this is a must-read',
  'spoiler alert', 'hot take', 'unpopular opinion',
  // Formal connectors (over-used by AI)
  'navigating the complexities', 'in conclusion', 'furthermore',
  'moreover', 'consequently', 'it is imperative', 'one might argue',
  'it goes without saying', 'needless to say', 'a testament to',
  'pivotal role', 'harness the power', 'unlock the potential',
  'foster innovation', 'drive growth', 'spearhead', 'underscore',
  'it\'s crucial to', 'it bears mentioning', 'stands as a beacon',
  'serves as a reminder', 'paves the way', 'sheds light on',
  'strikes a balance', 'bridges the gap',
];

// Weighted AI phrases — some are much stronger signals than others
const STRONG_AI_PHRASES = new Set([
  'delve into', 'delve deeper', 'it\'s important to note', 'it\'s worth noting',
  'navigating the complexities', 'stands as a beacon', 'serves as a reminder',
  'in the realm of', 'holistic approach',
]);

// Hedging phrases — AI uses these excessively
const HEDGING_PHRASES = [
  'arguably', 'it\'s worth noting', 'one might say', 'it could be argued',
  'to some extent', 'in many ways', 'it\'s fair to say', 'broadly speaking',
  'generally speaking', 'for the most part', 'by and large', 'as it were',
  'so to speak', 'if you will', 'in a sense', 'to a certain degree',
  'it remains to be seen', 'time will tell',
];

// Excessive transition words (AI over-connects ideas)
const TRANSITION_WORDS = [
  'however', 'furthermore', 'moreover', 'additionally', 'consequently',
  'nevertheless', 'nonetheless', 'subsequently', 'accordingly', 'hence',
  'thereby', 'thus', 'meanwhile', 'likewise', 'similarly',
  'in contrast', 'on the other hand', 'as a result', 'in addition',
  'that being said', 'with that in mind', 'having said that',
];

// LinkedIn-specific hook patterns
const LINKEDIN_HOOK_PATTERNS = [
  /^(?:I |We |This |Here'?s |Stop |Don'?t |Want to |Ready to )/i,
  /^(?:The (?:truth|secret|key|reality|problem|answer) (?:is|about))/i,
  /^(?:\d+ (?:things|lessons|tips|ways|reasons|mistakes|habits))/i,
  /^(?:Nobody talks about|Everyone is|Most people|The biggest mistake)/i,
  /^(?:Unpopular opinion|Hot take|Controversial)/i,
  /^(?:I (?:just|recently) (?:got|received|landed|started|left|quit))/i,
];

const LINKEDIN_CTA_PATTERNS = [
  /(?:agree|disagree|thoughts)\s*\?\s*$/i,
  /(?:comment|share|follow|repost|like)\s+(?:if|below|this)/i,
  /(?:DM me|drop me a|send me a|reach out)/i,
  /(?:link in (?:the |my )?(?:comments|bio|first comment))/i,
  /(?:what (?:do you|are your) think)/i,
  /(?:save this|bookmark this|share this)/i,
];

// ─── Layer A: Statistical Analysis ────────────────────────────────────

/**
 * Burstiness — measures sentence length variation.
 * AI produces uniform-length sentences; humans are erratic.
 * Enhanced: also checks per-paragraph burstiness.
 */
function computeBurstiness(sentences, paragraphs) {
  if (sentences.length < 3) return 0.5;

  const lengths = sentences.map((s) => s.split(/\s+/).length);
  const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  const variance = lengths.reduce((sum, l) => sum + (l - mean) ** 2, 0) / lengths.length;
  const cv = mean > 0 ? Math.sqrt(variance) / mean : 0;

  // Sentence-level burstiness
  const sentenceBurst = clamp(1 - cv, 0, 1);

  // Paragraph-level: check if paragraphs have similar sentence counts
  let paraBurst = 0.5;
  if (paragraphs.length >= 3) {
    const paraSentCounts = paragraphs.map(
      (p) => p.split(/[.!?]+/).filter((s) => s.trim().length > 0).length
    );
    const paraMean = paraSentCounts.reduce((a, b) => a + b, 0) / paraSentCounts.length;
    const paraVar = paraSentCounts.reduce((s, l) => s + (l - paraMean) ** 2, 0) / paraSentCounts.length;
    const paraCV = paraMean > 0 ? Math.sqrt(paraVar) / paraMean : 0;
    paraBurst = clamp(1 - paraCV, 0, 1);
  }

  // Also check for suspiciously similar consecutive sentence lengths
  let consecutiveSimilar = 0;
  for (let i = 1; i < lengths.length; i++) {
    if (Math.abs(lengths[i] - lengths[i - 1]) <= 2) consecutiveSimilar++;
  }
  const consecutiveRatio = consecutiveSimilar / (lengths.length - 1);
  const consecutiveBurst = clamp(consecutiveRatio, 0, 1);

  return sentenceBurst * 0.45 + paraBurst * 0.25 + consecutiveBurst * 0.30;
}

/**
 * Type-Token Ratio — vocabulary richness.
 * AI uses safe, mid-frequency words. Humans use more varied vocabulary.
 * Enhanced: uses moving-average TTR for length normalization.
 */
function computeTypeTokenRatio(words) {
  if (words.length < 10) return 0.5;
  const lower = words.map((w) => w.toLowerCase().replace(/[^a-z']/g, ''));

  // Standard TTR
  const unique = new Set(lower);
  const ttr = unique.size / lower.length;

  // Moving-Average TTR (MATTR) — window of 25 words for length normalization
  const windowSize = Math.min(25, lower.length);
  let mattrSum = 0;
  let mattrCount = 0;
  for (let i = 0; i <= lower.length - windowSize; i++) {
    const windowWords = lower.slice(i, i + windowSize);
    const windowUnique = new Set(windowWords);
    mattrSum += windowUnique.size / windowSize;
    mattrCount++;
  }
  const mattr = mattrCount > 0 ? mattrSum / mattrCount : ttr;

  // Hapax legomena ratio (words appearing only once)
  const freq = {};
  for (const w of lower) freq[w] = (freq[w] || 0) + 1;
  const hapax = Object.values(freq).filter((f) => f === 1).length;
  const hapaxRatio = hapax / lower.length;
  // Low hapax ratio → AI tends to reuse words
  const hapaxScore = clamp(1 - hapaxRatio * 2, 0, 1);

  const ttrScore = clamp(1 - (ttr - 0.3) / 0.5, 0, 1);
  const mattrScore = clamp(1 - (mattr - 0.5) / 0.3, 0, 1);

  return ttrScore * 0.35 + mattrScore * 0.40 + hapaxScore * 0.25;
}

/**
 * Sentence starter diversity — checks first 1-3 words of each sentence.
 * AI repeats structural patterns at sentence openings.
 */
function computeSentenceStarterDiversity(sentences) {
  if (sentences.length < 3) return 0.5;

  // 1-word starters
  const starters1 = sentences.map((s) => s.trim().split(/\s+/)[0]?.toLowerCase() || '');
  const unique1 = new Set(starters1);
  const ratio1 = unique1.size / starters1.length;

  // 2-word starters (captures "I am", "It is", "This is" patterns)
  const starters2 = sentences.map((s) => {
    const words = s.trim().split(/\s+/).slice(0, 2);
    return words.map((w) => w.toLowerCase()).join(' ');
  });
  const unique2 = new Set(starters2);
  const ratio2 = unique2.size / starters2.length;

  // Check for "I" repetition (very common in AI LinkedIn posts)
  const iStarters = starters1.filter((s) => s === 'i').length;
  const iRatio = iStarters / starters1.length;
  const iScore = iRatio > 0.4 ? 0.7 : iRatio > 0.25 ? 0.4 : 0;

  const diversityScore = clamp(1 - (ratio1 * 0.5 + ratio2 * 0.5), 0, 1);

  return diversityScore * 0.6 + iScore * 0.4;
}

/**
 * Punctuation profile — humans use more varied and informal punctuation.
 */
function computePunctuationProfile(text) {
  const total = text.length;
  if (total === 0) return 0.5;

  const dashes = (text.match(/[—–]/g) || []).length;
  const ellipses = (text.match(/\.{3}|…/g) || []).length;
  const parens = (text.match(/[()]/g) || []).length;
  const exclamation = (text.match(/!/g) || []).length;
  const question = (text.match(/\?/g) || []).length;
  const semicolons = (text.match(/;/g) || []).length;
  const colons = (text.match(/:/g) || []).length;

  // Count distinct punctuation types used
  const typesUsed = [dashes, ellipses, parens, exclamation, question, semicolons, colons]
    .filter((c) => c > 0).length;

  // Humans typically use 3+ punctuation types; AI sticks to periods and commas
  const varietyScore = clamp(1 - typesUsed / 5, 0, 1);

  // Check for excessive comma usage (AI tendency)
  const commas = (text.match(/,/g) || []).length;
  const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0).length;
  const commasPerSentence = sentences > 0 ? commas / sentences : 0;
  const commaScore = clamp((commasPerSentence - 1) / 3, 0, 1);

  return varietyScore * 0.6 + commaScore * 0.4;
}

/**
 * Word length distribution — AI clusters around average word lengths.
 */
function computeWordLengthDistribution(words) {
  if (words.length < 5) return 0.5;
  const lengths = words.map((w) => w.replace(/[^a-zA-Z]/g, '').length).filter((l) => l > 0);
  if (lengths.length < 5) return 0.5;
  const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  const variance = lengths.reduce((sum, l) => sum + (l - mean) ** 2, 0) / lengths.length;
  const stdDev = Math.sqrt(variance);
  return clamp(1 - stdDev / 4, 0, 1);
}

/**
 * Character-level entropy — proxy for perplexity.
 * AI text is more predictable → lower entropy in character bigrams.
 */
function computeCharEntropy(text) {
  const cleaned = text.toLowerCase().replace(/[^a-z ]/g, '');
  if (cleaned.length < 50) return 0.5;

  // Character bigram entropy
  const bigrams = {};
  let totalBigrams = 0;
  for (let i = 0; i < cleaned.length - 1; i++) {
    const bg = cleaned.slice(i, i + 2);
    bigrams[bg] = (bigrams[bg] || 0) + 1;
    totalBigrams++;
  }

  let entropy = 0;
  for (const bg in bigrams) {
    const p = bigrams[bg] / totalBigrams;
    entropy -= p * Math.log2(p);
  }

  // English text typically has bigram entropy of ~7-9 bits
  // AI text tends toward the lower end (more predictable)
  // Normalize: entropy < 7 → high AI, entropy > 8.5 → low AI
  return clamp(1 - (entropy - 6.5) / 2.5, 0, 1);
}

/**
 * Readability uniformity — AI produces text at a consistent reading level.
 * Uses a simplified Flesch-Kincaid approach.
 */
function computeReadabilityUniformity(sentences, words) {
  if (sentences.length < 4) return 0.5;

  // Compute per-sentence complexity (words per sentence × avg syllables)
  const perSentenceComplexity = sentences.map((s) => {
    const sWords = s.trim().split(/\s+/).filter((w) => w.length > 0);
    const avgSyllables = sWords.length > 0
      ? sWords.reduce((sum, w) => sum + estimateSyllables(w), 0) / sWords.length
      : 1;
    return sWords.length * avgSyllables;
  });

  // Check variance in complexity — AI is very consistent
  const mean = perSentenceComplexity.reduce((a, b) => a + b, 0) / perSentenceComplexity.length;
  const variance = perSentenceComplexity.reduce((s, c) => s + (c - mean) ** 2, 0) / perSentenceComplexity.length;
  const cv = mean > 0 ? Math.sqrt(variance) / mean : 0;

  // Low CV → uniform readability → more likely AI
  return clamp(1 - cv * 1.5, 0, 1);
}

function estimateSyllables(word) {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (w.length <= 3) return 1;
  let count = 0;
  const vowels = 'aeiouy';
  let prevVowel = false;
  for (const ch of w) {
    const isVowel = vowels.includes(ch);
    if (isVowel && !prevVowel) count++;
    prevVowel = isVowel;
  }
  if (w.endsWith('e') && count > 1) count--;
  return Math.max(1, count);
}

// ─── Layer B: Linguistic Pattern Detection ────────────────────────────

function detectAIPhrases(textLower) {
  const found = [];
  for (const phrase of AI_PHRASES) {
    if (textLower.includes(phrase.toLowerCase())) {
      found.push({
        phrase,
        strong: STRONG_AI_PHRASES.has(phrase),
      });
    }
  }
  return found;
}

/**
 * Hedging density — AI over-hedges to sound balanced.
 */
function computeHedgingDensity(textLower, wordCount) {
  if (wordCount < 20) return 0;
  let hedgeCount = 0;
  for (const phrase of HEDGING_PHRASES) {
    const regex = new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    const matches = textLower.match(regex);
    if (matches) hedgeCount += matches.length;
  }
  // More than 1 hedge per 50 words is suspicious
  const density = hedgeCount / (wordCount / 50);
  return clamp(density / 2, 0, 1);
}

/**
 * Transition word density — AI over-connects ideas with formal transitions.
 */
function computeTransitionDensity(textLower, sentenceCount) {
  if (sentenceCount < 3) return 0;
  let transCount = 0;
  for (const word of TRANSITION_WORDS) {
    const regex = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
    const matches = textLower.match(regex);
    if (matches) transCount += matches.length;
  }
  // More than 1 transition per 3 sentences is high for LinkedIn posts
  const density = transCount / (sentenceCount / 3);
  return clamp(density / 2, 0, 1);
}

/**
 * LinkedIn post structure analysis.
 * Detects the formulaic hook → story → lesson → CTA pattern.
 */
function analyzePostStructure(text, paragraphs) {
  const signals = [];
  let structureScore = 0;

  // Check for hook patterns in the first paragraph/line
  const firstLine = text.split('\n')[0] || '';
  for (const pattern of LINKEDIN_HOOK_PATTERNS) {
    if (pattern.test(firstLine)) {
      signals.push('Formulaic hook opening');
      structureScore += 0.2;
      break;
    }
  }

  // Check for CTA in the last paragraph
  const lastPara = paragraphs[paragraphs.length - 1] || '';
  for (const pattern of LINKEDIN_CTA_PATTERNS) {
    if (pattern.test(lastPara)) {
      signals.push('Call-to-action ending');
      structureScore += 0.2;
      break;
    }
  }

  // Check for numbered list format (very common in AI LinkedIn posts)
  const numberedLines = text.split('\n').filter((l) => /^\s*\d+[\.\)]\s/.test(l));
  if (numberedLines.length >= 3) {
    signals.push(`Numbered list (${numberedLines.length} items)`);
    structureScore += 0.15;
  }

  // Check for one-sentence paragraphs (AI LinkedIn style: short punchy paras)
  const oneLineParagraphs = paragraphs.filter((p) => {
    const sents = p.split(/[.!?]+/).filter((s) => s.trim().length > 0);
    return sents.length === 1;
  });
  const oneLineRatio = paragraphs.length > 0 ? oneLineParagraphs.length / paragraphs.length : 0;
  if (oneLineRatio > 0.6 && paragraphs.length >= 4) {
    signals.push('Excessive one-sentence paragraphs');
    structureScore += 0.15;
  }

  // Check for emoji-as-bullet pattern (🔑 Point one\n💡 Point two)
  const emojiBullets = text.split('\n').filter((l) =>
    /^[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}]/u.test(l.trim())
  );
  if (emojiBullets.length >= 3) {
    signals.push('Emoji bullet points');
    structureScore += 0.15;
  }

  // Paragraph count — AI LinkedIn posts tend to be 4-8 paragraphs
  if (paragraphs.length >= 4 && paragraphs.length <= 8) {
    structureScore += 0.05;
  }

  // Check for "line break after every sentence" pattern
  const lines = text.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length >= 5) {
    const avgWordsPerLine = lines.reduce((s, l) => s + l.split(/\s+/).length, 0) / lines.length;
    if (avgWordsPerLine < 15 && avgWordsPerLine > 3) {
      signals.push('Short-line formatting pattern');
      structureScore += 0.1;
    }
  }

  return { score: clamp(structureScore, 0, 1), signals };
}

function computeEmojiHashtagClustering(text) {
  const lines = text.split('\n');
  if (lines.length < 2) return { score: 0, signals: [] };

  const signals = [];
  const lastLines = lines.slice(-2).join(' ');
  const restLines = lines.slice(0, -2).join(' ');

  // Emoji clustering
  const emojiRegex = /[\u{1F000}-\u{1FFFF}]|[\u{2600}-\u{27BF}]|[\u{1F900}-\u{1F9FF}]/gu;
  const endEmojis = (lastLines.match(emojiRegex) || []).length;
  const restEmojis = (restLines.match(emojiRegex) || []).length;

  let score = 0;
  if (endEmojis > 2 && endEmojis > restEmojis) {
    signals.push('Emojis clustered at end');
    score += 0.4;
  }

  // Hashtag clustering at the end
  const endHashtags = (lastLines.match(/#\w+/g) || []).length;
  if (endHashtags >= 3) {
    signals.push(`${endHashtags} hashtags clustered at end`);
    score += 0.3;
  }

  // Excessive total hashtags
  const totalHashtags = (text.match(/#\w+/g) || []).length;
  if (totalHashtags >= 5) {
    signals.push('Excessive hashtag usage');
    score += 0.2;
  }

  return { score: clamp(score, 0, 1), signals };
}

/**
 * Repetition detection — AI sometimes repeats concepts or sentence structures.
 */
function computeRepetition(sentences) {
  if (sentences.length < 4) return { score: 0, signals: [] };

  const signals = [];
  let score = 0;

  // Check for repeated sentence templates (same structure, different nouns)
  // Simplified: check for sentences starting the same way
  const templateMap = {};
  for (const s of sentences) {
    const words = s.trim().split(/\s+/).slice(0, 3).map((w) => w.toLowerCase());
    const template = words.join(' ');
    templateMap[template] = (templateMap[template] || 0) + 1;
  }
  const repeatedTemplates = Object.entries(templateMap).filter(([, count]) => count >= 3);
  if (repeatedTemplates.length > 0) {
    signals.push('Repeated sentence structures');
    score += 0.4;
  }

  // Check for near-duplicate sentences (Jaccard similarity > 0.7)
  for (let i = 0; i < sentences.length; i++) {
    for (let j = i + 1; j < Math.min(i + 5, sentences.length); j++) {
      const set1 = new Set(sentences[i].toLowerCase().split(/\s+/));
      const set2 = new Set(sentences[j].toLowerCase().split(/\s+/));
      const intersection = new Set([...set1].filter((w) => set2.has(w)));
      const union = new Set([...set1, ...set2]);
      const jaccard = union.size > 0 ? intersection.size / union.size : 0;
      if (jaccard > 0.7 && set1.size > 5) {
        signals.push('Near-duplicate sentences detected');
        score += 0.3;
        break;
      }
    }
    if (score >= 0.7) break;
  }

  return { score: clamp(score, 0, 1), signals };
}

// ─── Sensitivity Adjustment ───────────────────────────────────────────

const SENSITIVITY_MULTIPLIERS = {
  low: 0.7,     // fewer false positives — requires stronger signals
  medium: 1.0,  // balanced
  high: 1.3,    // catch more AI — lower threshold
};

// ─── Combined Analysis ────────────────────────────────────────────────

/**
 * Analyze text for AI content.
 * @param {string} text - The post text
 * @param {object} options
 * @param {boolean} options.mlEnabled - If true, run ML model (Phase 4)
 * @param {string} options.sensitivity - 'low', 'medium', or 'high'
 * @param {AbortSignal} [options.signal]
 * @returns {object} { score, statistical, linguistic, ml, signals }
 */
export async function analyzeText(text, { mlEnabled = false, sensitivity = 'medium', signal } = {}) {
  if (!text || text.trim().length < 20) {
    return { score: 0, statistical: 0, linguistic: 0, ml: null, signals: ['Text too short to analyze'] };
  }

  const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0);
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  const paragraphs = text.split(/\n\n+/).filter((p) => p.trim().length > 0);
  const textLower = text.toLowerCase();
  const wordCount = words.length;
  const sentenceCount = sentences.length;

  // ─── Statistical Signals ───
  const burstiness = computeBurstiness(sentences, paragraphs);
  const ttr = computeTypeTokenRatio(words);
  const starterDiv = computeSentenceStarterDiversity(sentences);
  const punctuation = computePunctuationProfile(text);
  const wordLength = computeWordLengthDistribution(words);
  const charEntropy = computeCharEntropy(text);
  const readability = computeReadabilityUniformity(sentences, words);

  const statisticalScore = (
    burstiness * 0.22 +
    ttr * 0.15 +
    starterDiv * 0.13 +
    punctuation * 0.12 +
    wordLength * 0.10 +
    charEntropy * 0.15 +
    readability * 0.13
  ) * 100;

  // ─── Linguistic Signals ───
  const aiPhrases = detectAIPhrases(textLower);
  const hedging = computeHedgingDensity(textLower, wordCount);
  const transitions = computeTransitionDensity(textLower, sentenceCount);
  const structure = analyzePostStructure(text, paragraphs);
  const emojiHash = computeEmojiHashtagClustering(text);
  const repetition = computeRepetition(sentences);

  // Phrase score — strong phrases count double
  const phraseWeight = aiPhrases.reduce((sum, p) => sum + (p.strong ? 0.2 : 0.12), 0);
  const phraseScore = clamp(phraseWeight, 0, 1);

  const linguisticScore = (
    phraseScore * 0.25 +
    hedging * 0.10 +
    transitions * 0.10 +
    structure.score * 0.25 +
    emojiHash.score * 0.15 +
    repetition.score * 0.15
  ) * 100;

  // ─── Signals for Display ───
  const signals = [];
  if (burstiness > 0.6) signals.push('Uniform sentence lengths');
  if (ttr > 0.6) signals.push('Limited vocabulary diversity');
  if (starterDiv > 0.5) signals.push('Repetitive sentence starters');
  if (charEntropy > 0.6) signals.push('Low text entropy (predictable)');
  if (readability > 0.6) signals.push('Uniform readability level');
  if (hedging > 0.4) signals.push('Excessive hedging language');
  if (transitions > 0.4) signals.push('Over-use of transition words');

  for (const p of aiPhrases.slice(0, 3)) {
    signals.push(`AI phrase: "${p.phrase}"`);
  }
  signals.push(...structure.signals);
  signals.push(...emojiHash.signals);
  signals.push(...repetition.signals);

  // ─── Combined (heuristic only) ───
  const rawScore = statisticalScore * 0.45 + linguisticScore * 0.55;

  // Apply sensitivity multiplier
  const multiplier = SENSITIVITY_MULTIPLIERS[sensitivity] || 1.0;
  const adjustedScore = rawScore * multiplier;

  // ─── ML Model (Layer C) ───
  let ml = null;
  if (mlEnabled) {
    try {
      ml = await runTextML(text, signal);
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      // ML unavailable — gracefully degrade to heuristic-only
      ml = null;
    }
  }

  // Recompute final score incorporating ML if available
  let finalScore;
  if (ml != null) {
    // Full pipeline: statistical 20%, linguistic 25%, ML 55%
    finalScore = statisticalScore * 0.20 + linguisticScore * 0.25 + ml * 0.55;
  } else {
    finalScore = adjustedScore;
  }

  return {
    score: Math.round(clamp(finalScore, 0, 100)),
    statistical: Math.round(clamp(statisticalScore, 0, 100)),
    linguistic: Math.round(clamp(linguisticScore, 0, 100)),
    ml,
    signals,
  };
}

// ─── Utility ──────────────────────────────────────────────────────────

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}
