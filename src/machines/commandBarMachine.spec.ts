import { describe, expect, it, vi } from 'vitest'
import { createActor } from 'xstate'

import type { MachineManager } from '@src/lib/MachineManager'
import type { Command } from '@src/lib/commandTypes'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { validateGdtText } from '@src/lib/gdtTextValidation'
import { commandBarMachine } from '@src/machines/commandBarMachine'
import { GLOBAL_COMMAND_SCOPES } from '@src/registry/contracts/commands'

describe('commandBarMachine', () => {
  it.each([false, true])(
    'keeps invalid GDT text at the input step and accepts a corrected value (prefilled: %s)',
    async (prefilled) => {
      const onSubmit = vi.fn()
      const command = {
        scopes: GLOBAL_COMMAND_SCOPES,
        name: 'Test GDT Note',
        groupId: 'test',
        needsReview: true,
        onSubmit,
        args: {
          note: {
            inputType: 'text',
            required: true,
            validation: ({ data }) => validateGdtText({ data: data.note }),
          },
        },
      } satisfies Command
      const actor = createActor(commandBarMachine, {
        input: {
          commands: [command],
          wasmInstancePromise: Promise.resolve({} as ModuleType),
          machineManager: {} as MachineManager,
        },
      }).start()
      try {
        actor.send({ type: 'Open' })
        actor.send({
          type: 'Select command',
          data: {
            command,
            ...(prefilled
              ? { argDefaultValues: { note: 'Use "datum A"' } }
              : {}),
          },
        })
        if (!prefilled) {
          actor.send({
            type: 'Submit argument',
            data: { note: 'Use "datum A"' },
          })
        }
        await vi.waitFor(() => {
          expect(
            actor
              .getSnapshot()
              .matches({ 'Gathering arguments': 'Awaiting input' })
          ).toBe(true)
        })
        expect(actor.getSnapshot().context.argumentsToSubmit.note).toBe(
          prefilled ? 'Use "datum A"' : undefined
        )
        expect(onSubmit).not.toHaveBeenCalled()
        actor.send({
          type: 'Submit argument',
          data: { note: 'Use datum A' },
        })
        await vi.waitFor(() =>
          expect(actor.getSnapshot().matches('Review')).toBe(true)
        )
        expect(actor.getSnapshot().context.argumentsToSubmit.note).toBe(
          'Use datum A'
        )
      } finally {
        actor.stop()
      }
    }
  )
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

    const actor = createActor(commandBarMachine, {
      input: {
        commands: [command],
        wasmInstancePromise: Promise.resolve({} as ModuleType),
        machineManager: {} as MachineManager,
      },
    }).start()

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

    const actor = createActor(commandBarMachine, {
      input: {
        commands: [command],
        wasmInstancePromise: Promise.resolve({} as ModuleType),
        machineManager: {} as MachineManager,
      },
    }).start()

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
