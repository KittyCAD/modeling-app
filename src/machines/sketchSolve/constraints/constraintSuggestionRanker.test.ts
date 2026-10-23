import {
  CONSTRAINT_SUGGESTION_FEATURE_NAMES,
  parseConstraintSuggestionRankerModel,
  rankConstraintSuggestionsWithModel,
} from '@src/machines/sketchSolve/constraints/constraintSuggestionRanker'
import type { ConstraintSuggestion } from '@src/machines/sketchSolve/constraints/constraintSuggestions'
import { describe, expect, it } from 'vitest'

describe('local sketch constraint ranker', () => {
  it('rejects a model with mismatched features or nonfinite weights', () => {
    const weights = Array(CONSTRAINT_SUGGESTION_FEATURE_NAMES.length).fill(0)
    expect(
      parseConstraintSuggestionRankerModel({
        schema_version: 1,
        feature_names: [...CONSTRAINT_SUGGESTION_FEATURE_NAMES].reverse(),
        weights,
      })
    ).toBeInstanceOf(Error)
    weights[0] = Number.NaN
    expect(
      parseConstraintSuggestionRankerModel({
        schema_version: 1,
        feature_names: CONSTRAINT_SUGGESTION_FEATURE_NAMES,
        weights,
      })
    ).toBeInstanceOf(Error)
  })

  it('reorders solver-approved suggestions without removing them', () => {
    const weights = Array(CONSTRAINT_SUGGESTION_FEATURE_NAMES.length).fill(0)
    weights[5] = 2
    const model = parseConstraintSuggestionRankerModel({
      schema_version: 1,
      feature_names: CONSTRAINT_SUGGESTION_FEATURE_NAMES,
      weights,
    })
    expect(model).not.toBeInstanceOf(Error)
    if (model instanceof Error) {
      return
    }
    const suggestions: ConstraintSuggestion[] = [
      {
        label: 'Make horizontal',
        explanation: 'Near horizontal',
        payload: { type: 'Horizontal', line: 3 },
        score: 0.9,
        features: {
          normalizedResidual: 0.1,
          previewMovementRatio: 0,
          freePointFraction: 1,
        },
      },
      {
        label: 'Make vertical',
        explanation: 'Near vertical',
        payload: { type: 'Vertical', line: 3 },
        score: 0.8,
        features: {
          normalizedResidual: 0.2,
          previewMovementRatio: 0,
          freePointFraction: 1,
        },
      },
    ]
    const ranked = rankConstraintSuggestionsWithModel(suggestions, model)
    expect(ranked.map((suggestion) => suggestion.label)).toEqual([
      'Make vertical',
      'Make horizontal',
    ])
    expect(suggestions[0].label).toBe('Make horizontal')
  })
})
