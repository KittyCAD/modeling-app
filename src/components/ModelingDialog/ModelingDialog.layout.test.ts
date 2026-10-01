import type { ModelingDialogField } from '@src/components/ModelingDialog/ModelingDialog.arguments'
import { resolveDialogGroups } from '@src/components/ModelingDialog/ModelingDialog.layout'
import { describe, expect, it } from 'vitest'

function field(argName: string): ModelingDialogField {
  return {
    argName,
    arg: { inputType: 'string', required: false },
    isHidden: false,
    isRequired: false,
    isDisabled: false,
    options: [],
  }
}

describe('dialog layout', () => {
  it('orders visible fields once and retains arguments missing from the layout', () => {
    const fields = ['first', 'second', 'newArgument'].map(field)
    const layout = [
      { title: 'Main', args: ['second', 'first', 'hidden'] },
      { title: 'Duplicate', args: ['first'] },
      { title: 'Hidden', args: ['hidden'] },
    ]
    const snapshot = structuredClone(layout)
    const groups = resolveDialogGroups(fields, layout, {})

    expect(
      groups.map(({ title, fields }) => ({
        title,
        args: fields.map(({ argName }) => argName),
      }))
    ).toEqual([
      { title: 'Main', args: ['second', 'first'] },
      { title: 'Parameters', args: ['newArgument'] },
    ])
    expect(layout).toEqual(snapshot)
    expect(fields.map(({ argName }) => argName)).toEqual([
      'first',
      'second',
      'newArgument',
    ])
  })

  it.each([undefined, []])(
    'leaves commands without a layout to the generic renderer',
    (layout) => {
      expect(resolveDialogGroups([field('value')], layout, {})).toEqual([])
    }
  )

  it.each([
    [undefined, false],
    ['', false],
    [false, false],
    [true, true],
    [0, true],
    ['0deg', true],
  ])('opens more options for authored value %s: %s', (value, defaultOpen) => {
    expect(
      resolveDialogGroups(
        [field('value')],
        [{ title: 'More options', args: ['value'], collapsible: true }],
        { value }
      )[0].defaultOpen
    ).toBe(defaultOpen)
  })
})
