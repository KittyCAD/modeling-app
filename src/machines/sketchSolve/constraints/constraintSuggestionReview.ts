import type { ConstraintSuggestion } from '@src/machines/sketchSolve/constraints/constraintSuggestions'
import type { SketchSolveSelectionId } from '@src/machines/sketchSolve/sketchSolveSelection'

export function createConstraintSuggestionReviewTemplate(
  selectionIds: readonly SketchSolveSelectionId[],
  suggestions: readonly ConstraintSuggestion[]
) {
  return {
    schema_version: 1,
    sample_id: 'FILL_IN',
    project_family: 'FILL_IN',
    source_ref: 'FILL_IN',
    split: 'train',
    reviewer: 'FILL_IN',
    expected_action: 'unreviewed',
    review_reason: '',
    selection_ids: [...selectionIds],
    candidates: suggestions.map((suggestion) => ({
      constraint_type: suggestion.payload.type,
      candidate_payload: suggestion.payload,
      baseline_score: suggestion.score,
      ...suggestion.features,
      label: 'unreviewed',
      reason: '',
      dimension_edit: 'not_tested',
      dimension_edit_probe: {
        driver: 'FILL_IN',
        before: 'FILL_IN',
        after: 'FILL_IN',
        invariant: 'FILL_IN',
      },
    })),
  }
}
