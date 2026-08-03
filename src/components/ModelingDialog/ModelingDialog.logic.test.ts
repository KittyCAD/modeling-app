import {
  getActiveSelectionFieldName,
  invalidReviewValidationState,
  isBodyOnlySelectionArgument,
  type ModelingDialogSelectionField,
  type SelectionCommandArgument,
} from '@src/components/ModelingDialog/ModelingDialog.logic'
import { describe, expect, it } from 'vitest'

const selectionArg = {
  inputType: 'selection',
  selectionTypes: ['segment'],
} as SelectionCommandArgument

function selectionField(
  argName: string,
  overrides: Partial<ModelingDialogSelectionField> = {}
): ModelingDialogSelectionField {
  return {
    argName,
    arg: selectionArg,
    isHidden: false,
    isDisabled: false,
    ...overrides,
  }
}

describe('modeling dialog selection ownership', () => {
  it('does not assign a hidden active selection to another visible field', () => {
    const fields = [
      selectionField('profiles'),
      selectionField('edge', { isHidden: true }),
    ]

    expect(getActiveSelectionFieldName(fields, 'edge')).toBeUndefined()
  })

  it('returns the active field only while it can collect selections', () => {
    const fields = [selectionField('profiles')]

    expect(getActiveSelectionFieldName(fields, 'profiles')).toBe('profiles')
    expect(
      getActiveSelectionFieldName(
        [selectionField('profiles', { isDisabled: true })],
        'profiles'
      )
    ).toBeUndefined()
  })
})

describe('modeling dialog body selection coercion', () => {
  it('treats a selection that also accepts helices as body-only', () => {
    const arg = {
      inputType: 'selectionMixed',
      selectionTypes: ['path', 'sweep', 'compositeSolid', 'helix'],
    } as SelectionCommandArgument

    expect(isBodyOnlySelectionArgument(arg)).toBe(true)
  })

  it('does not coerce arguments that accept face selections', () => {
    const arg = {
      inputType: 'selectionMixed',
      selectionTypes: ['sweep', 'cap'],
    } as SelectionCommandArgument

    expect(isBodyOnlySelectionArgument(arg)).toBe(false)
  })
})

describe('modeling dialog review validation', () => {
  it('preserves codemod diff details from validation errors', () => {
    const details = {
      type: 'codemod' as const,
      currentCode: 'part = extrude(sketch, length = 10)',
      proposedCode: 'part = extrude(sketch, length = -10)',
    }
    const error = Object.assign(new Error('Failed to execute codemod'), {
      reviewDetails: details,
    })

    expect(invalidReviewValidationState(error)).toEqual({
      status: 'invalid',
      error: 'Failed to execute codemod',
      details,
    })
  })

  it('accepts machine-provided details with a string error', () => {
    const details = {
      type: 'codemod' as const,
      currentCode: 'before',
      proposedCode: 'after',
    }

    expect(invalidReviewValidationState('Validation failed', details)).toEqual({
      status: 'invalid',
      error: 'Validation failed',
      details,
    })
  })
})
