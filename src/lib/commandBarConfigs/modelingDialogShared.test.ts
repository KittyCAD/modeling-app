import {
  compactSelectionDialog,
  hasModelingDialogValue,
  modelingDialogLayout,
} from '@src/lib/commandBarConfigs/modelingDialogShared'
import { describe, expect, it } from 'vitest'

describe('modeling dialog config helpers', () => {
  it('treats empty selections as absent without dropping false values', () => {
    const emptySelection = { graphSelections: [], otherSelections: [] }

    expect(hasModelingDialogValue(undefined)).toBe(false)
    expect(hasModelingDialogValue(null)).toBe(false)
    expect(hasModelingDialogValue('')).toBe(false)
    expect(hasModelingDialogValue([])).toBe(false)
    expect(hasModelingDialogValue({})).toBe(false)
    expect(hasModelingDialogValue(emptySelection)).toBe(false)
    expect(hasModelingDialogValue(false)).toBe(true)
    expect(
      hasModelingDialogValue({
        valueAst: {},
        valueText: '5',
        valueCalculated: '5',
      })
    ).toBe(true)
    expect(
      hasModelingDialogValue({
        graphSelections: [{ artifact: undefined }],
        otherSelections: [],
      })
    ).toBe(true)
  })

  it('builds consistent compact selection and expandable layout fragments', () => {
    expect(
      compactSelectionDialog('profile', 'Select profiles', {
        orderedSelection: true,
      })
    ).toEqual({
      group: 'profile',
      selectionEmptyLabel: 'Select profiles',
      compactSelection: true,
      hideLabel: true,
      orderedSelection: true,
    })

    expect(
      modelingDialogLayout([{ id: 'profile', title: 'Profile' }]).groups
    ).toEqual([
      { id: 'profile', title: 'Profile' },
      { id: 'advanced', title: 'More options', collapsible: true },
    ])
  })
})
