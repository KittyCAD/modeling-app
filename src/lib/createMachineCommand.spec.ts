import { describe, expect, test, vi } from 'vitest'
import { createActor, createMachine } from 'xstate'

import type { StateMachineCommandSetConfig } from '@src/lib/commandTypes'
import { createMachineCommand } from '@src/lib/createMachineCommand'

const testMachine = createMachine({
  id: 'testMachine',
  initial: 'idle',
  states: {
    idle: {},
  },
})

type TestCommandSchema = {
  Available: Record<string, never>
  Experimental: Record<string, never>
  ManyCommands: Record<string, never>
}

const commandBarConfig = {
  Available: {
    description: 'Available command',
  },
  Experimental: {
    description: 'Experimental command',
    status: 'experimental',
  },
  ManyCommands: [
    {
      displayName: 'Experimental child',
      description: 'Experimental child command',
      status: 'experimental',
    },
    {
      displayName: 'Available child',
      description: 'Available child command',
    },
  ],
} satisfies StateMachineCommandSetConfig<typeof testMachine, TestCommandSchema>

describe('createMachineCommand', () => {
  test('hides experimental commands by default', () => {
    const actor = createActor(testMachine).start()

    const command = createMachineCommand<typeof testMachine, TestCommandSchema>(
      {
        groupId: testMachine.id,
        type: 'Experimental',
        state: actor.getSnapshot(),
        send: vi.fn(),
        actor,
        commandBarConfig,
      }
    )

    actor.stop()

    expect(command).toBeNull()
  })

  test('keeps experimental commands when enabled', () => {
    const actor = createActor(testMachine).start()

    const command = createMachineCommand<typeof testMachine, TestCommandSchema>(
      {
        groupId: testMachine.id,
        type: 'Experimental',
        state: actor.getSnapshot(),
        send: vi.fn(),
        actor,
        commandBarConfig,
        showExperimentalCommands: true,
      }
    )

    actor.stop()

    expect(command).toMatchObject({
      name: 'Experimental',
      status: 'experimental',
    })
  })

  test('passes experimental visibility into command arrays', () => {
    const actor = createActor(testMachine).start()

    const commands = createMachineCommand<
      typeof testMachine,
      TestCommandSchema
    >({
      groupId: testMachine.id,
      type: 'ManyCommands',
      state: actor.getSnapshot(),
      send: vi.fn(),
      actor,
      commandBarConfig,
    })

    actor.stop()

    expect(commands).toEqual([
      expect.objectContaining({
        name: 'ManyCommands',
        displayName: 'Available child',
      }),
    ])
  })
})
