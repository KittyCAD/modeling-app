import type { CommandKclArgument } from '@src/components/CommandBar/CommandKclInput'
import type { CommandKclChange } from '@src/components/CommandBar/CommandKclInput'
import { EditorView } from '@codemirror/view'
import type { Expr } from '@src/lang/wasm'
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

import { CommandKclInput } from '@src/components/CommandBar/CommandKclInput'
import { getInVariableCase } from '@src/lib/utils'

async function renderInput(
  createVariable?: CommandKclArgument['createVariable']
) {
  const onChange = vi.fn<(change: CommandKclChange) => void>()
  await act(async () => {
    render(
      <CommandKclInput
        name="length"
        arg={{ inputType: 'kcl', required: true, createVariable }}
        label="Distance"
        isRequired
        disabled={false}
        value="5"
        selectionRanges={{ graphSelections: [], otherSelections: [] }}
        onChange={onChange}
        onValidationChange={vi.fn()}
      />
    )
  })
  return onChange
}

describe('CommandKclInput', () => {
  it('reports toggling variable creation as a user edit before recalculation', async () => {
    const onChange = await renderInput()
    onChange.mockClear()
    const toggle = screen.getByRole('checkbox', { name: 'Create new variable' })

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

  it('keeps simultaneously mounted editors independent', async () => {
    const onLengthChange = vi.fn()
    const onAngleChange = vi.fn()
    await act(async () => {
      render(
        <>
          <CommandKclInput
            name="length"
            label="Length"
            arg={{ inputType: 'kcl', required: true }}
            isRequired
            disabled={false}
            value="5"
            selectionRanges={{ graphSelections: [], otherSelections: [] }}
            onChange={onLengthChange}
            onValidationChange={vi.fn()}
          />
          <CommandKclInput
            name="angle"
            label="Angle"
            arg={{ inputType: 'kcl', required: true }}
            isRequired
            disabled={false}
            value="90"
            selectionRanges={{ graphSelections: [], otherSelections: [] }}
            onChange={onAngleChange}
            onValidationChange={vi.fn()}
          />
        </>
      )
    })
    onLengthChange.mockClear()
    onAngleChange.mockClear()
    const length = screen.getByRole('textbox', { name: 'Length' })
    const angle = screen.getByRole('textbox', { name: 'Angle' })
    await act(async () => {
      EditorView.findFromDOM(length)?.dispatch({
        changes: { from: 0, to: 1, insert: '8' },
      })
    })
    expect(length).toHaveTextContent('8')
    expect(angle).toHaveTextContent('90')
    expect(onLengthChange).toHaveBeenCalledWith({ source: 'edit', value: '8' })
    expect(onAngleChange).not.toHaveBeenCalled()
  })
})
