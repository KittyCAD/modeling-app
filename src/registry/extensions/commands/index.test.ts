import {
  Registry,
  Slot,
  defineRegistryItem,
  provideService,
} from '@kittycad/registry'
import type { KclManager } from '@src/lang/KclManager'
import { MachineManager } from '@src/lib/MachineManager'
import type { Command } from '@src/lib/commandTypes'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import {
  commandSystemService,
  provideCommand,
} from '@src/registry/contracts/commands'
import { machineManagerService } from '@src/registry/contracts/machineManager'
import { provideWasmPromise } from '@src/registry/contracts/wasm'
import { describe, expect, it, vi } from 'vitest'
import { commandsExtension } from '.'
import { TOOLBAR_COMMAND_IDS, toolbarCommands } from './toolbarCommands'

describe('commands extension', () => {
  it('syncs registry command contributions into the command system service', () => {
    const commandsSlot = new Slot()
    const command: Command = {
      groupId: 'test',
      name: 'test-command',
      needsReview: false,
      onSubmit: vi.fn(),
    }
    const commandItem = defineRegistryItem({
      id: 'test-command-item',
      provides: [provideCommand(command)],
    })

    const registry = new Registry()
    registry.configure([
      defineRegistryItem({
        id: 'test-wasm-promise',
        provides: [provideWasmPromise(Promise.resolve({} as ModuleType))],
      }),
      defineRegistryItem({
        id: 'test-machine-manager',
        providesServices: [
          provideService(machineManagerService, new MachineManager()),
        ],
      }),
      commandsExtension,
      commandsSlot.of(commandItem),
    ])

    const commandSystem = registry.get(commandSystemService)
    expect(commandSystem.actor.getSnapshot().context.commands).toEqual([
      command,
    ])

    registry.reconfigure(commandsSlot, [])

    expect(commandSystem.actor.getSnapshot().context.commands).toEqual([])

    registry[Symbol.dispose]()
  })

  it('provides toolbar commands for keymap-backed tool selection', () => {
    expect(toolbarCommands.map((command) => command.id)).toContain(
      TOOLBAR_COMMAND_IDS.sketchSolve.vertical
    )
  })

  it('runs toolbar commands against the live KclManager when command context is missing', () => {
    const testWindow = window as unknown as {
      kclManager: KclManager | undefined
    }
    const previousKclManager = testWindow.kclManager
    const sentEvents: unknown[] = []
    testWindow.kclManager = {
      modelingState: {
        matches: (state: unknown) => state === 'sketchSolveMode',
        context: { sketchSolveToolName: null },
      },
      sendModelingEvent: (event: unknown) => {
        sentEvents.push(event)
        return true
      },
    } as unknown as KclManager

    try {
      const command = toolbarCommands.find(
        (candidate) => candidate.id === TOOLBAR_COMMAND_IDS.sketchSolve.line
      )

      expect(command?.onSubmit({})).toBe(true)
      expect(sentEvents).toEqual([
        { type: 'equip tool', data: { tool: 'lineTool' } },
      ])
    } finally {
      if (previousKclManager === undefined) {
        testWindow.kclManager = undefined
      } else {
        testWindow.kclManager = previousKclManager
      }
    }
  })
})
