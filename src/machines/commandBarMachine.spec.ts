import { describe, expect, it, vi } from 'vitest'
import { createActor } from 'xstate'

import type { MachineManager } from '@src/lib/MachineManager'
import type { Command } from '@src/lib/commandTypes'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { commandBarMachine } from '@src/machines/commandBarMachine'
import { GLOBAL_COMMAND_SCOPES } from '@src/registry/contracts/commands'

describe('commandBarMachine', () => {
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
