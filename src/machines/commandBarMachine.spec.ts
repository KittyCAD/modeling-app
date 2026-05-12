import { commandBarMachine } from '@src/machines/commandBarMachine'
import { describe, expect, it } from 'vitest'
import { createActor, waitFor } from 'xstate'
import type { Command } from '@src/lib/commandTypes'

describe('commandBarMachine', () => {
  it('validates a single submitted argument with the argument value', async () => {
    let validatedData: unknown
    let submittedData: unknown
    const command: Command = {
      name: 'component.create',
      displayName: 'Create Component',
      groupId: 'code',
      needsReview: false,
      args: {
        componentName: {
          inputType: 'string',
          required: true,
          validation: async ({ data }) => {
            validatedData = data
            return true
          },
        },
      },
      onSubmit: (data) => {
        submittedData = data
      },
    }
    const actor = createActor(commandBarMachine, {
      input: {
        commands: [command],
        wasmInstancePromise: Promise.resolve({} as never),
        machineManager: {} as never,
      },
    }).start()

    actor.send({ type: 'Open' })
    actor.send({
      type: 'Select command',
      data: { command },
    })
    expect(actor.getSnapshot().context.currentArgument?.name).toBe(
      'componentName'
    )
    actor.send({
      type: 'Submit argument',
      data: { componentName: 'myComponent' },
    })

    await waitFor(actor, () => submittedData !== undefined)

    expect(validatedData).toBe('myComponent')
    expect(submittedData).toEqual({ componentName: 'myComponent' })
  })
})
