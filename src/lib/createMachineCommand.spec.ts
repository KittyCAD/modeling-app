import { describe, expect, test, vi } from 'vitest'
import { createActor, createMachine } from 'xstate'

import type { StateMachineCommandSetConfig } from '@src/lib/commandTypes'
import { createMachineCommand } from '@src/lib/createMachineCommand'
import {
  GLOBAL_COMMAND_SCOPES,
  MODE_SKETCHING_COMMAND_SCOPE,
} from '@src/registry/contracts/commands'

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
  Deprecated: Record<string, never>
  ManyCommands: Record<string, never>
  WithArguments: {
    availableArg?: string
    experimentalArg?: string
    deprecatedArg?: string
  }
}

const commandBarConfig = {
  Available: {
    description: 'Available command',
  },
  Experimental: {
    description: 'Experimental command',
    status: 'experimental',
  },
  Deprecated: {
    description: 'Deprecated command',
    status: 'deprecated',
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
      scopes: [MODE_SKETCHING_COMMAND_SCOPE],
    },
  ],
  WithArguments: {
    description: 'Command with arguments',
    args: {
      availableArg: {
        inputType: 'string',
        required: false,
      },
      experimentalArg: {
        inputType: 'string',
        required: false,
        status: 'experimental',
      },
      deprecatedArg: {
        inputType: 'string',
        required: false,
        status: 'deprecated',
      },
    },
  },
} satisfies StateMachineCommandSetConfig<typeof testMachine, TestCommandSchema>

describe('createMachineCommand', () => {
  test('defaults only missing descriptions, including command arrays, without changing configs', () => {
    const actor = createActor(testMachine).start()
    const configs = {
      Available: {},
      ManyCommands: [{}, { description: 'Custom' }, { description: '' }],
    } satisfies StateMachineCommandSetConfig<
      typeof testMachine,
      TestCommandSchema
    >
    const getDefaultDescription = vi.fn((type: string) => `Default ${type}`)
    const props = {
      groupId: testMachine.id,
      state: actor.getSnapshot(),
      send: vi.fn(),
      actor,
      commandBarConfig: configs,
      defaultScopes: GLOBAL_COMMAND_SCOPES,
      getDefaultDescription,
    }

    const command = createMachineCommand<typeof testMachine, TestCommandSchema>(
      { ...props, type: 'Available' }
    )
    const commands = createMachineCommand<
      typeof testMachine,
      TestCommandSchema
    >({ ...props, type: 'ManyCommands' })
    const commandWithoutFallback = createMachineCommand<
      typeof testMachine,
      TestCommandSchema
    >({ ...props, type: 'Available', getDefaultDescription: undefined })

    actor.stop()

    expect(command).toMatchObject({ description: 'Default Available' })
    expect(commands).toMatchObject([
      { description: 'Default ManyCommands' },
      { description: 'Custom' },
      { description: '' },
    ])
    expect(commandWithoutFallback).toMatchObject({ description: undefined })
    expect(getDefaultDescription).toHaveBeenCalledTimes(2)
    expect(configs.Available).toEqual({})
    expect(configs.ManyCommands[0]).toEqual({})
  })

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
        defaultScopes: GLOBAL_COMMAND_SCOPES,
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
        defaultScopes: GLOBAL_COMMAND_SCOPES,
        showExperimentalCommands: true,
      }
    )

    actor.stop()

    expect(command).toMatchObject({
      name: 'Experimental',
      status: 'experimental',
    })
  })

  test('keeps deprecated commands visible by default', () => {
    const actor = createActor(testMachine).start()

    const command = createMachineCommand<typeof testMachine, TestCommandSchema>(
      {
        groupId: testMachine.id,
        type: 'Deprecated',
        state: actor.getSnapshot(),
        send: vi.fn(),
        actor,
        commandBarConfig,
        defaultScopes: GLOBAL_COMMAND_SCOPES,
      }
    )

    actor.stop()

    expect(command).toMatchObject({
      name: 'Deprecated',
      status: 'deprecated',
      scopes: GLOBAL_COMMAND_SCOPES,
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
      defaultScopes: GLOBAL_COMMAND_SCOPES,
    })

    actor.stop()

    expect(commands).toEqual([
      expect.objectContaining({
        name: 'ManyCommands',
        displayName: 'Available child',
        scopes: [MODE_SKETCHING_COMMAND_SCOPE],
      }),
    ])
  })

  test('hides experimental arguments by default', () => {
    const actor = createActor(testMachine).start()

    const command = createMachineCommand<typeof testMachine, TestCommandSchema>(
      {
        groupId: testMachine.id,
        type: 'WithArguments',
        state: actor.getSnapshot(),
        send: vi.fn(),
        actor,
        commandBarConfig,
        defaultScopes: GLOBAL_COMMAND_SCOPES,
      }
    )

    actor.stop()

    expect(command).toMatchObject({
      args: {
        availableArg: {
          hidden: undefined,
        },
        deprecatedArg: {
          hidden: undefined,
          status: 'deprecated',
        },
        experimentalArg: {
          hidden: true,
          status: 'experimental',
        },
      },
    })
  })

  test('keeps experimental arguments visible when enabled', () => {
    const actor = createActor(testMachine).start()

    const command = createMachineCommand<typeof testMachine, TestCommandSchema>(
      {
        groupId: testMachine.id,
        type: 'WithArguments',
        state: actor.getSnapshot(),
        send: vi.fn(),
        actor,
        commandBarConfig,
        defaultScopes: GLOBAL_COMMAND_SCOPES,
        showExperimentalCommands: true,
      }
    )

    actor.stop()

    expect(command).toMatchObject({
      args: {
        availableArg: {
          hidden: undefined,
        },
        experimentalArg: {
          hidden: undefined,
          status: 'experimental',
        },
      },
    })
  })
})
