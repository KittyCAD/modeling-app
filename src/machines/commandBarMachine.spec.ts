import { describe, expect, it, vi } from 'vitest'
import { createActor } from 'xstate'
import { commandBarMachine } from '@src/machines/commandBarMachine'
import type { Command } from '@src/lib/commandTypes'

describe('commandBarMachine', () => {
  it('cleans up temporary OpenCascade rollback edits after void review submits', async () => {
    const endOpenCascadeRollbackEdit = vi.fn().mockResolvedValue(undefined)
    const onSubmit = vi.fn()
    const command = {
      name: 'Void review command',
      groupId: 'test',
      needsReview: true,
      onSubmit,
      args: {
        value: {
          inputType: 'string',
          required: true,
        },
      },
    } satisfies Command
    const actor = createActor(commandBarMachine, {
      input: {
        commands: [command],
        wasmInstancePromise: Promise.resolve({} as never),
        machineManager: {} as never,
      },
    })

    actor.start()
    actor.send({
      type: 'Set kclManager',
      data: { endOpenCascadeRollbackEdit } as never,
    })
    actor.send({ type: 'Open' })
    actor.send({ type: 'Select command', data: { command } })
    actor.send({ type: 'Submit argument', data: { value: 'ok' } })

    await vi.waitFor(() =>
      expect(actor.getSnapshot().matches('Review')).toBe(true)
    )

    actor.send({
      type: 'Submit command',
      output: {
        argumentsToSubmit: actor.getSnapshot().context.argumentsToSubmit,
      },
    })

    expect(onSubmit).toHaveBeenCalledWith({ value: 'ok' })
    await vi.waitFor(() =>
      expect(endOpenCascadeRollbackEdit).toHaveBeenCalledOnce()
    )
  })
})
