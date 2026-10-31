import type { ConstraintSuggestion } from '@src/machines/sketchSolve/constraints/constraintSuggestions'
import { isArray } from '@src/lib/utils'

export const SUGGESTION_RANKER_MODEL_KEY = 'sketch-constraint-ranker-poc-v2'

const constraintTypes = [
  'Horizontal',
  'Vertical',
  'Parallel',
  'Perpendicular',
  'LinesEqualLength',
  'EqualRadius',
  'Tangent',
  'Symmetric',
  'Distance',
  'Radius',
  'Diameter',
] as const

export const CONSTRAINT_SUGGESTION_FEATURE_NAMES = [
  'intercept',
  'normalizedResidual',
  'previewMovementRatio / 0.05',
  'freePointFraction',
  ...constraintTypes.map((type) => `type:${type}`),
] as const

export type ConstraintSuggestionRankerModel = {
  schema_version: 2
  feature_names: string[]
  weights: number[]
}

export function parseConstraintSuggestionRankerModel(
  value: unknown
): ConstraintSuggestionRankerModel | Error {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('schema_version' in value) ||
    value.schema_version !== 2 ||
    !('feature_names' in value) ||
    !isArray(value.feature_names) ||
    value.feature_names.length !== CONSTRAINT_SUGGESTION_FEATURE_NAMES.length ||
    !value.feature_names.every(
      (name: unknown, index: number) =>
        name === CONSTRAINT_SUGGESTION_FEATURE_NAMES[index]
    ) ||
    !('weights' in value) ||
    !isArray(value.weights) ||
    value.weights.length !== CONSTRAINT_SUGGESTION_FEATURE_NAMES.length ||
    !value.weights.every(
      (weight: unknown) => typeof weight === 'number' && Number.isFinite(weight)
    )
  ) {
    return new Error('Invalid local sketch constraint ranker model')
  }
  return value as ConstraintSuggestionRankerModel
}

export function readLocalConstraintSuggestionRankerModel():
  | ConstraintSuggestionRankerModel
  | Error
  | null {
  let stored: string | null
  try {
    stored = window.sessionStorage.getItem(SUGGESTION_RANKER_MODEL_KEY)
  } catch {
    return null
  }
  if (stored === null) {
    return null
  }
  try {
    return parseConstraintSuggestionRankerModel(JSON.parse(stored))
  } catch {
    return new Error('Invalid local sketch constraint ranker model JSON')
  }
}

function modelProbability(
  suggestion: ConstraintSuggestion,
  model: ConstraintSuggestionRankerModel
) {
  const typeIndex = constraintTypes.indexOf(
    suggestion.payload.type as (typeof constraintTypes)[number]
  )
  if (typeIndex < 0) {
    return 0
  }
  const { normalizedResidual, previewMovementRatio, freePointFraction } =
    suggestion.features
  const weights = model.weights
  const logit =
    weights[0] +
    weights[1] * normalizedResidual +
    weights[2] * (previewMovementRatio / 0.05) +
    weights[3] * freePointFraction +
    weights[4 + typeIndex]
  return 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, logit))))
}

export function rankConstraintSuggestionsWithModel(
  suggestions: readonly ConstraintSuggestion[],
  model: ConstraintSuggestionRankerModel
) {
  return [...suggestions].sort(
    (first, second) =>
      modelProbability(second, model) - modelProbability(first, model) ||
      second.score - first.score
  )
}
