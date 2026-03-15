/**
 * Ensemble Scorer — combines heuristic and ML results into final scores.
 *
 * Scoring weights adapt based on what data is available:
 * - Text only: text score is the overall
 * - Text + Image: 50/50 split
 * - Text + Video: 40/60 split (video is stronger signal)
 * - Image/Video only: media score is the overall
 *
 * Within each modality, weights shift based on whether ML is available:
 * - Without ML: statistical 45%, linguistic 55%
 * - With ML:    statistical 20%, linguistic 25%, ML 55%
 */

/**
 * Compute final ensemble score from heuristic and ML results.
 * @param {object} heuristicResult - From AnalysisQueue.runHeuristics()
 * @param {object} mlResult - From AnalysisQueue.runML()
 * @param {object} postData - { text, imageUrls, hasVideo }
 * @returns {object} Final result with overall, text, image, signals
 */
export function computeEnsemble(heuristicResult, mlResult, postData) {
  const result = {
    overall: 0,
    text: null,
    image: null,
    video: null,
    signals: [...(heuristicResult.signals || [])],
  };

  // ─── Text Score ───
  if (heuristicResult.text) {
    const textHeuristic = heuristicResult.text;
    const textML = mlResult?.textML?.ml;

    if (textML != null) {
      // Full pipeline: statistical 20%, linguistic 25%, ML 55%
      result.text = {
        statistical: textHeuristic.statistical,
        linguistic: textHeuristic.linguistic,
        ml: textML,
        combined: Math.round(
          textHeuristic.statistical * 0.20 +
          textHeuristic.linguistic * 0.25 +
          textML * 0.55
        ),
      };
    } else {
      // Heuristic only: statistical 45%, linguistic 55%
      result.text = {
        statistical: textHeuristic.statistical,
        linguistic: textHeuristic.linguistic,
        ml: null,
        combined: textHeuristic.score,
      };
    }
  }

  // ─── Image Score ───
  if (mlResult?.imageML?.score != null) {
    const imgResult = mlResult.imageML;
    result.image = {
      metadata: imgResult.metadata != null ? Math.round(imgResult.metadata) : null,
      frequency: imgResult.frequency != null ? Math.round(imgResult.frequency) : null,
      ml: imgResult.ml != null ? Math.round(imgResult.ml) : null,
      combined: Math.round(imgResult.score),
    };
    result.signals.push(...(imgResult.signals || []));
  }

  // ─── Overall Score ───
  const hasText = result.text != null;
  const hasImage = result.image != null;
  const hasVideo = result.video != null;

  if (hasText && hasImage) {
    result.overall = Math.round(result.text.combined * 0.50 + result.image.combined * 0.50);
  } else if (hasText && hasVideo) {
    result.overall = Math.round(result.text.combined * 0.40 + result.video.combined * 0.60);
  } else if (hasText) {
    result.overall = result.text.combined;
  } else if (hasImage) {
    result.overall = result.image.combined;
  } else if (hasVideo) {
    result.overall = result.video.combined;
  }

  result.overall = Math.max(0, Math.min(100, result.overall));

  return result;
}
