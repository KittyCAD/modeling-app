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
import type { CommandBarContext } from '@src/machines/commandBarMachine'
import {
  commandSystemService,
  provideCommand,
} from '@src/registry/contracts/commands'
import {
  FILE_AND_CODE_EDITOR_KEYMAP_SCOPES,
  FILE_KEYMAP_SCOPES,
  GLOBAL_KEYMAP_SCOPES,
  HOME_KEYMAP_SCOPE,
  MODE_MODELING_KEYMAP_SCOPE,
  MODE_SKETCH_NO_FACE_KEYMAP_SCOPE,
  MODE_SKETCH_SOLVE_KEYMAP_SCOPE,
  MODE_SKETCHING_KEYMAP_SCOPE,
  SETTINGS_KEYMAP_SCOPE,
  SKETCH_KEYMAP_SCOPES,
} from '@src/registry/contracts/keymap'
import { machineManagerService } from '@src/registry/contracts/machineManager'
import { provideWasmPromise } from '@src/registry/contracts/wasm'
import { describe, expect, it, vi } from 'vitest'
import { commandsExtension } from '.'
import { APP_COMMAND_IDS, appCommands } from './appCommands'
import { TOOLBAR_COMMAND_IDS, toolbarCommands } from './toolbarCommands'

function createCommandBarContext({
  kclManager,
  userFeatures,
}: {
  kclManager: KclManager
  userFeatures?: NonNullable<CommandBarContext['userFeatures']>
}): CommandBarContext {
  const context: CommandBarContext = {
    commands: [],
    wasmInstancePromise: Promise.resolve({} as ModuleType),
    machineManager: new MachineManager(),
    argumentsToSubmit: {},
    kclManager,
  }

  if (userFeatures) {
    context.userFeatures = userFeatures
  }

  return context
}

describe('commands extension', () => {
  it('syncs registry command contributions into the command system service', () => {
    const commandsSlot = new Slot()
    const command: Command = {
      scopes: GLOBAL_KEYMAP_SCOPES,
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
          provideService(machineManagerService, {
            manager: new MachineManager(),
          }),
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

  it('provides an app command for every app command id', () => {
    const appCommandIds = Object.values(APP_COMMAND_IDS).flatMap((group) =>
      Object.values(group)
    )

    expect(appCommands.map((command) => command.id).toSorted()).toEqual(
      appCommandIds.toSorted()
    )
  })

  it('classifies every registry command into an explicit context', () => {
    expect(
      [...appCommands, ...toolbarCommands].every(
        (command) => command.scopes.length > 0
      )
    ).toBe(true)
  })

  it.each([
    [APP_COMMAND_IDS.editor.undo, FILE_AND_CODE_EDITOR_KEYMAP_SCOPES],
    [APP_COMMAND_IDS.editor.redo, FILE_AND_CODE_EDITOR_KEYMAP_SCOPES],
    [APP_COMMAND_IDS.editor.format, FILE_AND_CODE_EDITOR_KEYMAP_SCOPES],
    [
      APP_COMMAND_IDS.editor.convertToVariable,
      FILE_AND_CODE_EDITOR_KEYMAP_SCOPES,
    ],
    [APP_COMMAND_IDS.editor.render, FILE_AND_CODE_EDITOR_KEYMAP_SCOPES],
    [APP_COMMAND_IDS.modeling.deleteSelection, FILE_KEYMAP_SCOPES],
    [APP_COMMAND_IDS.modeling.centerCameraOnSelection, FILE_KEYMAP_SCOPES],
    [APP_COMMAND_IDS.modeling.selectAllInCurrentSketch, SKETCH_KEYMAP_SCOPES],
    [APP_COMMAND_IDS.modeling.toggleSnapToGrid, FILE_KEYMAP_SCOPES],
    [APP_COMMAND_IDS.view.reset, FILE_KEYMAP_SCOPES],
    [APP_COMMAND_IDS.search.focusProjects, [HOME_KEYMAP_SCOPE]],
    [APP_COMMAND_IDS.search.focusSettings, [SETTINGS_KEYMAP_SCOPE]],
  ] as const)('scopes app command %s', (commandId, scopes) => {
    expect(
      appCommands.find((command) => command.id === commandId)?.scopes
    ).toEqual(scopes)
  })

  it('scopes toolbar command families to their owning mode', () => {
    expect(
      toolbarCommands.find(
        (command) => command.id === TOOLBAR_COMMAND_IDS.modeling.sketch
      )?.scopes
    ).toEqual([MODE_MODELING_KEYMAP_SCOPE])
    expect(
      toolbarCommands.find(
        (command) => command.id === TOOLBAR_COMMAND_IDS.sketching.exit
      )?.scopes
    ).toEqual([MODE_SKETCHING_KEYMAP_SCOPE, MODE_SKETCH_NO_FACE_KEYMAP_SCOPE])
    expect(
      toolbarCommands
        .filter(
          (command) =>
            command.id?.startsWith('zds.toolbar.sketchLegacy.') &&
            command.id !== TOOLBAR_COMMAND_IDS.sketching.exit
        )
        .every(
          (command) =>
            command.scopes.length === 1 &&
            command.scopes[0] === MODE_SKETCHING_KEYMAP_SCOPE
        )
    ).toBe(true)
    expect(
      toolbarCommands
        .filter((command) => command.id?.startsWith('zds.toolbar.sketch.'))
        .every(
          (command) =>
            command.scopes.length === 1 &&
            command.scopes[0] === MODE_SKETCH_SOLVE_KEYMAP_SCOPE
        )
    ).toBe(true)
  })

  it('exposes view commands with command palette metadata', () => {
    const searchableAppCommands = appCommands.filter(
      (command) => command.hideFromSearch !== true
    )

    expect(searchableAppCommands).toHaveLength(2)
    expect(searchableAppCommands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: APP_COMMAND_IDS.modeling.centerCameraOnSelection,
          displayName: 'Center camera on selection',
          description: 'Center the camera on the current selection.',
          icon: 'camera',
          scopes: FILE_KEYMAP_SCOPES,
        }),
        expect.objectContaining({
          id: APP_COMMAND_IDS.view.reset,
          displayName: 'Reset view',
          description: 'Restore the default camera position and view.',
          icon: 'refresh',
          scopes: FILE_KEYMAP_SCOPES,
        }),
      ])
    )
  })

  it('runs toolbar commands against the KclManager from command input', () => {
    const sentEvents: unknown[] = []
    const kclManager = {
      modelingState: {
        matches: (state: unknown) => state === 'sketchSolveMode',
        context: { sketchSolveToolName: null },
      },
      sendModelingEvent: (event: unknown) => {
        sentEvents.push(event)
        return true
      },
    } as unknown as KclManager

    const command = toolbarCommands.find(
      (candidate) => candidate.id === TOOLBAR_COMMAND_IDS.sketchSolve.line
    )

    expect(
      command?.onSubmit({
        context: { kclManager } as CommandBarContext,
      })
    ).toBe(true)
    expect(sentEvents).toEqual([
      { type: 'equip tool', data: { tool: 'lineTool' } },
    ])
  })

  it('does not run experimental toolbar commands without the user feature flag', () => {
    const sentEvents: unknown[] = []
    const kclManager = {
      modelingState: {
        matches: (state: unknown) => state === 'sketchSolveMode',
        context: { sketchSolveToolName: null },
      },
      sendModelingEvent: (event: unknown) => {
        sentEvents.push(event)
        return true
      },
    } as unknown as KclManager

    const command = toolbarCommands.find(
      (candidate) => candidate.id === TOOLBAR_COMMAND_IDS.sketchSolve.spline
    )

    expect(command).toBeDefined()
    expect(
      command?.onSubmit({
        context: createCommandBarContext({ kclManager }),
      })
    ).toBeUndefined()
    expect(sentEvents).toEqual([])
  })

  it('runs experimental toolbar commands with the user feature flag', () => {
    const sentEvents: unknown[] = []
    const kclManager = {
      modelingState: {
        matches: (state: unknown) => state === 'sketchSolveMode',
        context: { sketchSolveToolName: null },
      },
      sendModelingEvent: (event: unknown) => {
        sentEvents.push(event)
        return true
      },
    } as unknown as KclManager
    const userFeatures = {
      has: vi.fn(() => true),
    } satisfies NonNullable<CommandBarContext['userFeatures']>

    const command = toolbarCommands.find(
      (candidate) => candidate.id === TOOLBAR_COMMAND_IDS.sketchSolve.spline
    )

    expect(command).toBeDefined()
    expect(
      command?.onSubmit({
        context: createCommandBarContext({ kclManager, userFeatures }),
      })
    ).toBe(true)
    expect(sentEvents).toEqual([
      { type: 'equip tool', data: { tool: 'splineTool' } },
    ])
  })

  it('exits sketch solve mode while a sketch solve tool is equipped', () => {
    const sentEvents: unknown[] = []
    const kclManager = {
      modelingState: {
        matches: (state: unknown) => state === 'sketchSolveMode',
        context: { sketchSolveToolName: 'lineTool' },
      },
      sendModelingEvent: (event: unknown) => {
        sentEvents.push(event)
        return true
      },
    } as unknown as KclManager

    const command = toolbarCommands.find(
      (candidate) => candidate.id === TOOLBAR_COMMAND_IDS.sketchSolve.exit
    )

    expect(
      command?.onSubmit({
        context: { kclManager } as CommandBarContext,
      })
    ).toBe(true)
    expect(sentEvents).toEqual([{ type: 'Exit sketch' }])
  })

  it('runs toolbar commands selected by keymaps against the command bar KclManager', () => {
    const sentEvents: unknown[] = []
    const kclManager = {
      modelingState: {
        matches: (state: unknown) => state === 'sketchSolveMode',
        context: { sketchSolveToolName: null },
      },
      sendModelingEvent: (event: unknown) => {
        sentEvents.push(event)
        return true
      },
    } as unknown as KclManager
    const command = toolbarCommands.find(
      (candidate) => candidate.id === TOOLBAR_COMMAND_IDS.sketchSolve.line
    )
    if (!command) {
      throw new Error('Missing sketch solve line toolbar command')
    }

    const registry = new Registry()
    registry.configure([
      defineRegistryItem({
        id: 'test-wasm-promise',
        provides: [provideWasmPromise(Promise.resolve({} as ModuleType))],
      }),
      defineRegistryItem({
        id: 'test-machine-manager',
        providesServices: [
          provideService(machineManagerService, {
            manager: new MachineManager(),
          }),
        ],
      }),
      commandsExtension,
      defineRegistryItem({
        id: 'test-toolbar-command',
        provides: [provideCommand(command)],
      }),
    ])

    const commandSystem = registry.get(commandSystemService)
    commandSystem.actor.send({ type: 'Set kclManager', data: kclManager })
    expect(commandSystem.actor.getSnapshot().context.kclManager).toBe(
      kclManager
    )
    commandSystem.send({
      type: 'Find and select command',
      data: {
        groupId: command.groupId,
        name: String(command.name),
      },
    })

    expect(sentEvents).toEqual([
      { type: 'equip tool', data: { tool: 'lineTool' } },
    ])

    registry[Symbol.dispose]()
  })

  it('runs select all in current sketch from keymaps outside legacy sketch state', () => {
    const sentEvents: unknown[] = []
    const kclManager = {
      modelingState: {
        matches: () => false,
      },
      artifactGraph: new Map(),
      sceneEntitiesManager: {
        activeSegments: {},
      },
      sendModelingEvent: (event: unknown) => {
        sentEvents.push(event)
        return true
      },
    } as unknown as KclManager
    const command = appCommands.find(
      (candidate) =>
        candidate.id === APP_COMMAND_IDS.modeling.selectAllInCurrentSketch
    )

    expect(command).toBeDefined()
    command?.onSubmit({
      context: { kclManager } as CommandBarContext,
    })

    expect(sentEvents).toEqual([
      {
        type: 'Set selection',
        data: {
          selectionType: 'completeSelection',
          selection: {
            graphSelections: [],
            otherSelections: [],
          },
        },
      },
    ])
  })
})
