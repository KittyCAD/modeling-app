import type { ComponentProps } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { ModelingArgumentFields } from '@src/components/ModelingDialog/ModelingArgumentFields'
import { DialogSelectionListView } from '@src/components/ModelingDialog/DialogSelectionListView'
import { createTestSettings } from '@src/lib/kcl/testFixtures'
import type { DialogField } from '@src/components/ModelingDialog/arguments'
import type { Selections } from '@src/machines/modelingSharedTypes'

const profiles: DialogField = {
  name: 'profiles',
  required: true,
  arg: {
    inputType: 'selection',
    displayName: 'Profiles',
    required: true,
    multiple: true,
    selectionTypes: ['plane'],
  },
}
const fields: DialogField[] = [
  profiles,
  {
    name: 'length',
    required: true,
    arg: { inputType: 'number', required: true },
  },
]
const picked: Selections = {
  graphSelections: [],
  otherSelections: [
    { name: 'XY', id: 'xy-plane' },
    { name: 'YZ', id: 'yz-plane' },
  ],
}

function setup(submittedValues: Record<string, unknown> = {}) {
  const update = vi.fn(),
    select = vi.fn(),
    focus = vi.fn()
  const props: ComponentProps<typeof ModelingArgumentFields> = {
    fields,
    context: {
      selectedCommand: undefined,
      argumentsToSubmit: { profiles: picked, length: 5 },
    },
    submittedValues,
    settings: createTestSettings(),
    wasmPromise: new Promise(() => {}),
    selection: {
      selectionRanges: picked,
      activeName: 'profiles',
      update,
      select,
      focus,
    },
    save: vi.fn(),
    updateValidation: vi.fn(),
    firstFieldName: 'profiles',
    renderSelectionList: (selectionRanges, onChange) => (
      <DialogSelectionListView
        state={{ status: 'ready', references: [] }}
        selectionRanges={selectionRanges}
        onChange={onChange}
      />
    ),
  }
  render(<ModelingArgumentFields {...props} />)
  return { update, select, focus }
}

it('focuses the first selection field and restores it after removing one of several picks', () => {
  const { update, select, focus } = setup()
  const button = screen.getByRole('button', { name: 'Select Profiles' })
  expect(button).toHaveFocus()
  expect(focus).toHaveBeenCalledWith('profiles', profiles.arg)
  fireEvent.click(button)
  expect(select).toHaveBeenCalledWith('profiles', profiles.arg)
  screen.getByRole('textbox', { name: /Length/ }).focus()
  fireEvent.click(
    screen.getAllByRole('button', {
      name: /Remove Selection from selection/,
    })[1]
  )
  expect(update).toHaveBeenCalledWith('profiles', {
    graphSelections: [],
    otherSelections: [{ name: 'XY', id: 'xy-plane' }],
  })
  expect(button).toHaveFocus()
})

it('retains the legacy restriction on editing a command selection', () => {
  const { update, select } = setup({ nodeToEdit: {} })
  const button = screen.getByRole('button', { name: 'Select Profiles' })
  expect(button).toBeDisabled()
  fireEvent.click(button)
  expect(select).not.toHaveBeenCalled()
  expect(
    screen.queryByRole('button', { name: /Remove/ })
  ).not.toBeInTheDocument()
  expect(update).not.toHaveBeenCalled()
})
