import type { ApiConstraint } from '@rust/kcl-lib/bindings/FrontendApi'

export const SUGGESTION_METRICS_KEY = 'sketch-constraint-suggestions-poc-v1'

type MetricName =
  | 'requested'
  | 'autoRequested'
  | 'manualRequested'
  | 'modelRanked'
  | 'candidate'
  | 'solverRejected'
  | 'geometryRejected'
  | 'previewPassed'
  | 'shown'
  | 'accepted'
  | 'applied'
  | 'applyFailed'

type SuggestionMetrics = {
  counts: Partial<Record<MetricName, number>>
  byConstraintType: Record<string, Partial<Record<MetricName, number>>>
  previewRuns: number
  totalPreviewMs: number
}

function readMetrics(): SuggestionMetrics {
  try {
    const stored = window.sessionStorage.getItem(SUGGESTION_METRICS_KEY)
    if (stored) {
      const parsed: unknown = JSON.parse(stored)
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        'counts' in parsed &&
        typeof parsed.counts === 'object' &&
        parsed.counts !== null &&
        'byConstraintType' in parsed &&
        typeof parsed.byConstraintType === 'object' &&
        parsed.byConstraintType !== null
      ) {
        return parsed as SuggestionMetrics
      }
    }
  } catch {
    // Storage can be unavailable in private or restricted windows.
  }
  return {
    counts: {},
    byConstraintType: {},
    previewRuns: 0,
    totalPreviewMs: 0,
  }
}

function writeMetrics(metrics: SuggestionMetrics) {
  try {
    window.sessionStorage.setItem(
      SUGGESTION_METRICS_KEY,
      JSON.stringify(metrics)
    )
  } catch {
    // Metrics must never interrupt sketching.
  }
}

export function recordSuggestionMetric(
  name: MetricName,
  constraintType?: ApiConstraint['type']
) {
  const metrics = readMetrics()
  metrics.counts[name] = (metrics.counts[name] ?? 0) + 1
  if (constraintType) {
    const counts = metrics.byConstraintType[constraintType] ?? {}
    counts[name] = (counts[name] ?? 0) + 1
    metrics.byConstraintType[constraintType] = counts
  }
  writeMetrics(metrics)
}

export function recordSuggestionPreviewTime(milliseconds: number) {
  const metrics = readMetrics()
  metrics.previewRuns += 1
  metrics.totalPreviewMs += milliseconds
  writeMetrics(metrics)
}
