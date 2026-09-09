import { describe, expect, it, vi } from 'vitest'
import { createActor } from 'xstate'

import type { MachineManager } from '@src/lib/MachineManager'
import type { Command } from '@src/lib/commandTypes'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { commandBarMachine } from '@src/machines/commandBarMachine'
import { GLOBAL_COMMAND_SCOPES } from '@src/registry/contracts/commands'

function createCommandBarActor(commands: Command[]) {
  return createActor(commandBarMachine, {
    input: {
      commands,
      wasmInstancePromise: Promise.resolve({} as ModuleType),
      machineManager: {} as MachineManager,
    },
  }).start()
}

describe('commandBarMachine', () => {
  const objects = { graphSelections: [], otherSelections: [] }
  const importCommand: Command = {
    scopes: GLOBAL_COMMAND_SCOPES,
    name: 'Import',
    groupId: 'code',
    needsReview: true,
    onSubmit: vi.fn(),
    redirect: ({ argumentsToSubmit }) =>
      argumentsToSubmit.path === 'washer.kcl'
        ? {
            name: 'Clone',
            groupId: 'modeling',
            argDefaultValues: { objects },
          }
        : undefined,
    args: {
      path: { inputType: 'string', required: true },
      localName: { inputType: 'string', required: true },
    },
  }
  const cloneCommand: Command = {
    scopes: GLOBAL_COMMAND_SCOPES,
    name: 'Clone',
    groupId: 'modeling',
    needsReview: true,
    onSubmit: vi.fn(),
    args: {
      objects: {
        inputType: 'selectionMixed',
        required: true,
        selectionTypes: ['sweep'],
        multiple: false,
      },
      variableName: { inputType: 'string', required: true },
    },
  }

  it.each(['selected', 'prefilled'])(
    'redirects a %s path to Clone, preserving its naming and review steps',
    async (entryPoint) => {
      const actor = createCommandBarActor([importCommand, cloneCommand])
      if (entryPoint === 'prefilled') {
        actor.send({
          type: 'Find and select command',
          data: {
            name: 'Import',
            groupId: 'code',
            argDefaultValues: { path: 'washer.kcl' },
          },
        })
      } else {
        actor.send({ type: 'Open' })
        actor.send({ type: 'Select command', data: { command: importCommand } })
        actor.send({ type: 'Submit argument', data: { path: 'washer.kcl' } })
      }
      await vi.waitFor(() => {
        expect(actor.getSnapshot().context.selectedCommand?.name).toBe('Clone')
        expect(actor.getSnapshot().context.currentArgument?.name).toBe(
          'variableName'
        )
      })
      expect(actor.getSnapshot().context.argumentsToSubmit).toEqual({
        objects,
        variableName: undefined,
      })
      actor.send({
        type: 'Submit argument',
        data: { variableName: 'clone001' },
      })
      await vi.waitFor(() =>
        expect(actor.getSnapshot().matches('Review')).toBe(true)
      )
      expect(actor.getSnapshot().context.argumentsToSubmit).toEqual({
        objects,
        variableName: 'clone001',
      })
      expect(importCommand.onSubmit).not.toHaveBeenCalled()
      expect(cloneCommand.onSubmit).not.toHaveBeenCalled()
      actor.send({ type: 'Close' })
      expect(actor.getSnapshot().matches('Closed')).toBe(true)
      expect(actor.getSnapshot().context.selectedCommand).toBeUndefined()
      actor.stop()
    }
  )

  it('continues Import for a new file or an unavailable redirect target', () => {
    for (const filePath of ['new.kcl', 'washer.kcl']) {
      const actor = createCommandBarActor([importCommand])
      actor.send({
        type: 'Find and select command',
        data: {
          name: 'Import',
          groupId: 'code',
          argDefaultValues: { path: filePath },
        },
      })
      expect(actor.getSnapshot().context.selectedCommand?.name).toBe('Import')
      expect(actor.getSnapshot().context.currentArgument?.name).toBe(
        'localName'
      )
      actor.stop()
    }
  })

  it('preserves hidden default values that are not declared command args', () => {
    const command = {
      scopes: GLOBAL_COMMAND_SCOPES,
      name: 'Test command',
      groupId: 'test',
      needsReview: false,
      onSubmit: vi.fn(),
      args: {
        visible: {
          inputType: 'string',
          required: false,
          hidden: (context) => Boolean(context.argumentsToSubmit.nodeToEdit),
        },
      },
    } satisfies Command

    const actor = createCommandBarActor([command])

    actor.send({ type: 'Open' })
    actor.send({
      type: 'Select command',
      data: {
        command,
        argDefaultValues: {
          nodeToEdit: ['body', 0],
          visible: 'default value',
        },
      },
    })

    expect(actor.getSnapshot().context.argumentsToSubmit).toMatchObject({
      nodeToEdit: ['body', 0],
      visible: 'default value',
    })

    actor.stop()
  })

  it('clears codemod review details when review is closed or submitted', async () => {
    const reviewDetails = {
      type: 'codemod' as const,
      currentCode: 'x = 1',
      proposedCode: 'x = 2',
    }
    const reviewError = Object.assign(new Error('Mock execution failed'), {
      reviewDetails,
    })
    const command = {
      scopes: GLOBAL_COMMAND_SCOPES,
      name: 'Test codemod',
      groupId: 'test',
      needsReview: true,
      reviewValidation: vi.fn().mockResolvedValue(reviewError),
      onSubmit: vi.fn(),
      args: {
        optional: {
          inputType: 'string',
          required: false,
        },
      },
    } satisfies Command

    const actor = createCommandBarActor([command])

    actor.send({ type: 'Open' })
    actor.send({
      type: 'Select command',
      data: { command },
    })

    await vi.waitFor(() => {
      expect(actor.getSnapshot().matches('Review')).toBe(true)
    })
    expect(actor.getSnapshot().context.reviewValidationError).toBe(
      reviewError.message
    )
    expect(actor.getSnapshot().context.reviewValidationDetails).toEqual(
      reviewDetails
    )

    actor.send({ type: 'Close' })
    expect(actor.getSnapshot().context.reviewValidationError).toBeUndefined()
    expect(actor.getSnapshot().context.reviewValidationDetails).toBeUndefined()

    actor.send({ type: 'Open' })
    actor.send({
      type: 'Select command',
      data: { command },
    })

    await vi.waitFor(() => {
      expect(actor.getSnapshot().matches('Review')).toBe(true)
    })
    expect(actor.getSnapshot().context.reviewValidationDetails).toEqual(
      reviewDetails
    )

    actor.send({
      type: 'Submit command',
      output: {
        argumentsToSubmit: actor.getSnapshot().context.argumentsToSubmit,
      },
    })
    expect(actor.getSnapshot().context.reviewValidationError).toBeUndefined()
    expect(actor.getSnapshot().context.reviewValidationDetails).toBeUndefined()
    expect(command.onSubmit).toHaveBeenCalledOnce()

    actor.stop()
  })
})
