import {
  getActiveSelectionFieldName,
  invalidReviewValidationState,
  isBodyOnlySelectionArgument,
  type ModelingDialogSelectionField,
  moveSelectionInSequence,
  type SelectionCommandArgument,
  shouldResolveDialogDefaultValue,
} from '@src/components/ModelingDialog/ModelingDialog.logic'
import type { CommandArgument } from '@src/lib/commandTypes'
import type { Selections } from '@src/machines/modelingSharedTypes'
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

describe('modeling dialog defaults', () => {
  it('can prepopulate a hidden conditional field only in the dialog', () => {
    const arg = {
      inputType: 'kcl',
      required: false,
      defaultValue: '45deg',
      dialog: { prepopulate: true },
    } as CommandArgument<unknown>

    expect(shouldResolveDialogDefaultValue(arg, false)).toBe(true)
    expect(arg.prepopulate).toBeUndefined()
  })
})

describe('ordered dialog selections', () => {
  it('moves a selection without mutating the captured value', () => {
    const source = {
      graphSelections: [{ id: 'first' }, { id: 'second' }, { id: 'third' }],
      otherSelections: [],
    } as unknown as Selections

    const moved = moveSelectionInSequence(source, 'graphSelections', 1, 'up')

    expect(moved?.graphSelections).toEqual([
      source.graphSelections[1],
      source.graphSelections[0],
      source.graphSelections[2],
    ])
    expect(source.graphSelections).toEqual([
      { id: 'first' },
      { id: 'second' },
      { id: 'third' },
    ])
  })

  it('does not cross the graph and engine selection sequences', () => {
    const source = {
      graphSelections: [{ id: 'graph' }],
      otherSelections: [{ id: 'engine-1' }, { id: 'engine-2' }],
    } as unknown as Selections

    const moved = moveSelectionInSequence(source, 'otherSelections', 1, 'up')

    expect(moved?.graphSelections).toEqual(source.graphSelections)
    expect(moved?.otherSelections).toEqual([
      source.otherSelections[1],
      source.otherSelections[0],
    ])
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
