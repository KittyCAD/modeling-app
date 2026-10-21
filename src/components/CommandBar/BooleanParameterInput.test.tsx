import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { expect, it, vi } from 'vitest'
import { BooleanParameterInput } from '@src/components/CommandBar/BooleanParameterInput'
import type { BooleanInputValue } from '@src/lib/booleanInput'
import type { KclExpression } from '@src/lib/commandTypes'

it('searches boolean parameters and switches between bindings, literals, and the default', async () => {
  const user = userEvent.setup()
  const onChange = vi.fn()
  const node = {
    start: 0,
    end: 0,
    moduleId: 0,
    commentStart: 0,
    outerAttrs: [],
    preComments: [],
  }
  const binding: KclExpression = {
    valueAst: {
      ...node,
      type: 'Name',
      abs_path: false,
      path: [],
      name: { ...node, type: 'Identifier', name: 'mirrorEnabled' },
    },
    valueText: 'mirrorEnabled',
    valueCalculated: 'false',
  }
  const options = [
    { name: 'Use default', value: undefined },
    { name: 'On', value: true },
    { name: 'Off', value: false },
    { name: 'mirrorEnabled (Off)', value: binding },
  ]
  function Input() {
    const [value, setValue] = useState<BooleanInputValue>()
    return (
      <>
        <label htmlFor="symmetric">Symmetric</label>
        <BooleanParameterInput
          id="symmetric"
          value={value}
          options={options}
          onChange={(next) => {
            setValue(next)
            onChange(next)
          }}
        />
      </>
    )
  }
  render(<Input />)
  const input = screen.getByRole('combobox', { name: 'Symmetric' })
  const button = screen.getByRole('button', { name: 'Choose boolean value' })
  await user.click(button)
  await user.click(screen.getByRole('option', { name: 'On' }))
  expect(onChange).toHaveBeenLastCalledWith(true)
  expect(input).toHaveValue('On')

  await user.clear(input)
  await user.type(input, 'mirror')
  expect(screen.queryByRole('option', { name: 'On' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('option', { name: 'mirrorEnabled (Off)' }))
  expect(onChange).toHaveBeenLastCalledWith(binding)
  expect(input).toHaveValue('mirrorEnabled (Off)')

  await user.click(button)
  await user.click(screen.getByRole('option', { name: 'Off' }))
  expect(onChange).toHaveBeenLastCalledWith(false)
  await user.click(button)
  await user.click(screen.getByRole('option', { name: 'Use default' }))
  expect(onChange).toHaveBeenLastCalledWith(undefined)
  expect(input).toHaveValue('Use default')
})
