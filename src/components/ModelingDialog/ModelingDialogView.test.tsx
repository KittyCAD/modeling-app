import { createRef, type FormEvent } from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import {
  ModelingDialogFields,
  ModelingDialogView,
} from '@src/components/ModelingDialog/ModelingDialogView'
import type { DialogField } from '@src/components/ModelingDialog/arguments'

const command = {
  name: 'Extrude',
  displayName: 'Extrude',
  description: 'Add depth to a profile.',
}

it('keeps submission eligibility, validation feedback, and the host footer accessory', () => {
  const submit = vi.fn((event: FormEvent<HTMLFormElement>) =>
    event.preventDefault()
  )
  const cancel = vi.fn()
  const containerRef = createRef<HTMLDivElement>()
  const view = (canSubmit: boolean) => (
    <div ref={containerRef}>
      <ModelingDialogView
        containerRef={containerRef}
        command={command}
        canSubmit={canSubmit}
        error="Choose a profile"
        onSubmit={submit}
        onCancel={cancel}
        footerAccessory={<button type="button">Form mode</button>}
      >
        <label>
          Profiles
          <input aria-label="Profiles" />
        </label>
      </ModelingDialogView>
    </div>
  )
  const mounted = render(view(false))
  const dialog = screen.getByRole('region', { name: 'Extrude' })
  expect(within(dialog).getByRole('button', { name: 'Submit' })).toBeDisabled()
  expect(within(dialog).getByText('Choose a profile')).toBeVisible()
  fireEvent.click(within(dialog).getByRole('button', { name: 'Form mode' }))
  expect(submit).not.toHaveBeenCalled()
  mounted.rerender(view(true))
  fireEvent.click(within(dialog).getByRole('button', { name: 'Submit' }))
  expect(submit).toHaveBeenCalledOnce()
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
  expect(cancel).toHaveBeenCalledOnce()
})

it('lets an input consume Escape before dismissing the dialog', () => {
  const cancel = vi.fn()
  const containerRef = createRef<HTMLDivElement>()
  render(
    <div ref={containerRef}>
      <ModelingDialogView
        containerRef={containerRef}
        command={command}
        canSubmit
        onSubmit={(e) => e.preventDefault()}
        onCancel={cancel}
      >
        <input
          aria-label="Input with a popup"
          onKeyDown={(e) => e.preventDefault()}
        />
        <input aria-label="Plain input" />
      </ModelingDialogView>
    </div>
  )
  fireEvent.keyDown(
    screen.getByRole('textbox', { name: 'Input with a popup' }),
    { key: 'Escape' }
  )
  expect(cancel).not.toHaveBeenCalled()
  fireEvent.keyDown(screen.getByRole('textbox', { name: 'Plain input' }), {
    key: 'Escape',
  })
  expect(cancel).toHaveBeenCalledOnce()
})

it('keeps loading separate from ordinary and advanced arguments', () => {
  const fields: DialogField[] = [
    {
      name: 'Length',
      required: true,
      arg: { inputType: 'number', required: true },
    },
    {
      name: 'Tag',
      required: false,
      arg: { inputType: 'text', required: false, dialog: { advanced: true } },
    },
  ]
  const renderFields = (values: DialogField[]) =>
    values.map((field) => (
      <label key={field.name}>
        {field.name}
        <input aria-label={field.name} />
      </label>
    ))
  const mounted = render(
    <ModelingDialogFields
      fields={fields}
      renderFields={renderFields}
      initializing
    />
  )
  expect(screen.getByText('Loading arguments...')).toBeVisible()
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  mounted.rerender(
    <ModelingDialogFields fields={fields} renderFields={renderFields} />
  )
  expect(screen.getByRole('textbox', { name: 'Length' })).toBeVisible()
  expect(screen.getByLabelText('Tag')).not.toBeVisible()
  fireEvent.click(screen.getByText('Advanced', { selector: 'summary' }))
  expect(screen.getByRole('textbox', { name: 'Tag' })).toBeVisible()
})
