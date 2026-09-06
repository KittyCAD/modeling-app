import { MachineManager } from '@src/lib/MachineManager'
import type { CommandArgument } from '@src/lib/commandTypes'
import type { CommandBarContext } from '@src/machines/commandBarMachine'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@src/lib/kclHelpers', () => ({ stringToKclExpression: vi.fn() }))

import { reconcileDialogOptions } from '@src/components/ModelingDialog/ModelingDialog.arguments'

function optionContext(
  argument: Extract<CommandArgument<unknown>, { inputType: 'options' }>
): CommandBarContext {
  return {
    commandInvocationId: 1,
    commands: [],
    argumentsToSubmit: {},
    machineManager: new MachineManager(),
    wasmInstancePromise: new Promise<never>(() => {}),
    selectedCommand: {
      name: 'Options',
      groupId: 'modeling',
      scopes: ['mode-modeling'],
      needsReview: true,
      useModelingDialog: true,
      onSubmit: () => {},
      args: { choice: argument },
    },
  }
}

describe('modeling dialog option reconciliation', () => {
  it('preserves a selected object after an equivalent listing refresh', () => {
    const selected = { id: 'printer-2', state: 'idle' }
    const context = optionContext({
      inputType: 'options',
      required: true,
      options: () => [
        { name: 'Printer 1', value: { id: 'printer-1', state: 'idle' } },
        { name: 'Printer 2', value: { ...selected } },
      ],
    })

    expect(reconcileDialogOptions(context, { choice: selected }).choice).toBe(
      selected
    )
  })

  it.each(['changed', 'removed'])(
    'does not switch printers when the selected printer is %s',
    (change) => {
      const selected = { id: 'printer-2', state: 'idle' }
      const context = optionContext({
        inputType: 'options',
        required: true,
        options: () => [
          { name: 'Printer 1', value: { id: 'printer-1', state: 'idle' } },
          ...(change === 'changed'
            ? [
                {
                  name: 'Printer 2',
                  value: { ...selected, state: 'printing' },
                  disabled: true,
                },
              ]
            : []),
        ],
      })

      expect(reconcileDialogOptions(context, { choice: selected }).choice).toBe(
        selected
      )
    }
  )

  it('preserves a nonempty choice that is absent from static options', () => {
    const context = optionContext({
      inputType: 'options',
      required: true,
      options: [{ name: 'First', value: 'first' }],
    })

    expect(reconcileDialogOptions(context, { choice: 'second' }).choice).toBe(
      'second'
    )
  })

  it('still repairs scalar choices when their dependencies change', () => {
    const context = optionContext({
      inputType: 'options',
      required: true,
      options: ({ argumentsToSubmit }) =>
        argumentsToSubmit.format === 'stl'
          ? [
              { name: 'Binary', value: 'binary' },
              { name: 'ASCII', value: 'ascii', isCurrent: true },
            ]
          : [{ name: 'Embedded', value: 'embedded' }],
    })

    expect(
      reconcileDialogOptions(context, {
        choice: 'embedded',
        format: 'stl',
      }).choice
    ).toBe('ascii')
  })
})
