import type { KclCommandArgument } from '@src/components/ModelingDialog/ModelingDialog.arguments'
import type { ModelingDialogKclChange } from '@src/components/ModelingDialog/ModelingDialogKclInput'
import type { Expr } from '@src/lang/wasm'
import type { CommandBarContext } from '@src/machines/commandBarMachine'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { useCallback, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const ast = { body: [], start: 0, end: 0, moduleId: 0, commentStart: 0 }
  const valueNode: Expr = {
    type: 'Literal',
    value: { value: 5, suffix: 'None' },
    raw: '5',
    start: 0,
    end: 1,
    moduleId: 0,
    commentStart: 0,
  }
  return {
    wasmPromise: Promise.resolve({}),
    registry: { optional: () => undefined },
    settings: { app: { theme: { current: 'light' } } },
    kclManager: {
      ast,
      astSignal: { value: ast },
      codeSignal: { value: '' },
      variablesSignal: { value: {} },
    },
    valueNode,
    prevVariables: [],
  }
})

vi.mock('@src/lib/boot', () => ({
  useApp: () => ({
    wasmPromise: mocks.wasmPromise,
    registry: mocks.registry,
    settings: { useSettings: () => mocks.settings },
  }),
  useSingletons: () => ({ kclManager: mocks.kclManager }),
}))
vi.mock('@src/lib/kclHelpers', () => ({ stringToKclExpression: vi.fn() }))
vi.mock('@src/lib/useCalculateKclExpression', () => ({
  useCalculateKclExpression: () => {
    const [newVariableName, setName] = useState('length001')
    const setNewVariableName = useCallback((name: string) => {
      setName(name ? getInVariableCase(name) || '' : '')
    }, [])
    return {
      valueNode: mocks.valueNode,
      calcResult: '5',
      newVariableInsertIndex: 0,
      newVariableName,
      setNewVariableName,
      isNewVariableNameUnique: newVariableName !== '',
      prevVariables: mocks.prevVariables,
      isExecuting: false,
    }
  },
}))

import { ModelingDialogKclInput } from '@src/components/ModelingDialog/ModelingDialogKclInput'
import { getInVariableCase } from '@src/lib/utils'

async function renderInput(
  createVariable?: KclCommandArgument['createVariable']
) {
  const onChange = vi.fn<(change: ModelingDialogKclChange) => void>()
  await act(async () => {
    render(
      <ModelingDialogKclInput
        name="length"
        arg={{ inputType: 'kcl', required: true, createVariable }}
        label="Distance"
        isRequired
        disabled={false}
        value="5"
        commandBarContext={{ argumentsToSubmit: {} } as CommandBarContext}
        selectionRanges={{ graphSelections: [], otherSelections: [] }}
        onChange={onChange}
        onValidationChange={vi.fn()}
      />
    )
  })
  return onChange
}

describe('modeling dialog variable edits', () => {
  it('reports toggling variable creation as a user edit before recalculation', async () => {
    const onChange = await renderInput()
    onChange.mockClear()
    const toggle = screen.getByRole('button', { name: 'Create variable' })

    fireEvent.click(toggle)

    expect(onChange.mock.calls[0][0]).toMatchObject({
      source: 'edit',
      value: { valueAst: mocks.valueNode, valueText: '5' },
    })
    const createdValue = onChange.mock.calls.at(-1)?.[0].value
    expect(createdValue).toMatchObject({ variableName: 'length001' })
    onChange.mockClear()

    fireEvent.click(toggle)

    expect(onChange.mock.calls[0][0]).toEqual({
      source: 'edit',
      value: createdValue,
    })
    expect(onChange.mock.calls.at(-1)?.[0].value).not.toHaveProperty(
      'variableName'
    )
  })

  it('preserves the enriched value when a name edit normalizes to the same name', async () => {
    const onChange = await renderInput('byDefault')
    const createdValue = onChange.mock.calls.at(-1)?.[0].value
    onChange.mockClear()

    fireEvent.change(screen.getByRole('textbox', { name: 'Variable name' }), {
      target: { value: 'length 001' },
    })

    expect(screen.getByRole('textbox', { name: 'Variable name' })).toHaveValue(
      'length001'
    )
    expect(onChange).toHaveBeenCalledExactlyOnceWith({
      source: 'edit',
      value: createdValue,
    })
    expect(createdValue).toMatchObject({ variableName: 'length001' })
  })

  it('reports Backspace disabling variable creation as a user edit', async () => {
    const onChange = await renderInput('byDefault')
    const nameInput = screen.getByRole('textbox', { name: 'Variable name' })
    fireEvent.change(nameInput, { target: { value: '' } })
    onChange.mockClear()

    fireEvent.keyDown(nameInput, { key: 'Backspace' })

    expect(onChange.mock.calls[0][0]).toEqual({ source: 'edit', value: '5' })
    expect(
      screen.getByRole('button', { name: 'Create variable' })
    ).toHaveAttribute('aria-pressed', 'false')
  })
})
