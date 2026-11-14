import { effect, untracked } from '@preact/signals-core'
import type { Command } from '@src/lib/commandTypes'
import {
  type CommandBarMachineEvent,
  commandBarMachine,
} from '@src/machines/commandBarMachine'
import {
  observations as commandsObservations,
  COMMAND_PALETTE_OPEN_COMMAND_SCOPE,
  type CommandScopeService,
  type CommandSystemService,
  commandKey,
  commandSystemService,
  commandsFacet,
} from '@src/registry/contracts/commands'
import type { MachineManager } from '@src/lib/MachineManager'
import { machineManagerExtension } from '@src/registry/extensions/machineManager'
import { observations as projectSessionObservations } from '@src/registry/contracts/projectSession'
import { observations as userFeaturesObservations } from '@src/registry/contracts/userFeatures'
import { observations as wasmObservations } from '@src/registry/contracts/wasm'
import { useSelector } from '@xstate/react'
import {
  factory as defineFactory,
  contribute,
  provide,
  type Factory,
} from 'plankton'
import { createActor } from 'xstate'
import { createAppCommands } from './appCommands'
import { createToolbarCommands } from './toolbarCommands'

type FindAndSelectCommandEvent = Extract<
  CommandBarMachineEvent,
  {
    type: 'Find and select command'
  }
>
export const createCommandsExtension = (
  machines: Factory<{ manager: MachineManager }> = machineManagerExtension
) =>
  defineFactory({
    dependencies: {
      commands: commandsObservations,
      machines,
      wasm: wasmObservations,
    },
    key: 'commands-extension',
    create: ({ commands: commandsInputs, machines, wasm: wasmInputs }) => {
      const commandsSignal = commandsInputs.commandsFacet
      let commandBarActor: CommandSystemService['actor'] | undefined
      let commandPaletteScopeOwner: CommandScopeService | undefined
      let stopCommandPaletteScopeSync: (() => void) | undefined
      let stopCommandsEffect: (() => void) | undefined
      let registeredCommands: readonly Command[] = []
      let pendingCommandSelections: FindAndSelectCommandEvent[] = []

      const commandIsRegistered = (event: FindAndSelectCommandEvent) =>
        commandBarActor
          ?.getSnapshot()
          .context.commands.some(
            (command) =>
              command.name === event.data.name &&
              command.groupId === event.data.groupId
          ) ?? false

      const flushPendingCommandSelections = () => {
        if (!commandBarActor || pendingCommandSelections.length === 0) {
          return
        }
        const readySelections =
          pendingCommandSelections.filter(commandIsRegistered)
        pendingCommandSelections = pendingCommandSelections.filter(
          (event) => !commandIsRegistered(event)
        )

        for (const event of readySelections) {
          commandBarActor.send(event)
        }
      }

      const ensureActor = () => {
        if (commandBarActor) {
          return commandBarActor
        }
        const machineManager = machines.manager
        const wasmPromise =
          wasmInputs.wasmPromiseFacet.value ??
          Promise.reject(new Error('Missing WASM promise registry value.'))

        commandBarActor = createActor(commandBarMachine, {
          input: {
            commands: [],
            wasmInstancePromise: wasmPromise,
            machineManager,
          },
        }).start()

        const syncCommandPaletteScope = () => {
          const commandScopes = commandsInputs.commandScopeService.current.value
          if (!commandScopes || !commandBarActor) {
            return
          }
          if (commandPaletteScopeOwner !== commandScopes) {
            commandPaletteScopeOwner?.removeScope(
              COMMAND_PALETTE_OPEN_COMMAND_SCOPE
            )
            commandPaletteScopeOwner = commandScopes
          }

          if (commandBarActor.getSnapshot().matches('Closed')) {
            commandScopes.removeScope(COMMAND_PALETTE_OPEN_COMMAND_SCOPE)
          } else {
            commandScopes.applyScope(COMMAND_PALETTE_OPEN_COMMAND_SCOPE)
          }
        }

        syncCommandPaletteScope()
        const commandPaletteScopeSubscription = commandBarActor.subscribe(() =>
          untracked(syncCommandPaletteScope)
        )
        stopCommandPaletteScopeSync = () =>
          commandPaletteScopeSubscription.unsubscribe()

        stopCommandsEffect = effect(() => {
          const nextCommands = commandsSignal.value

          if (registeredCommands.length > 0) {
            commandBarActor?.send({
              type: 'Remove commands',
              data: { commands: [...registeredCommands] },
            })
          }

          if (nextCommands.length > 0) {
            commandBarActor?.send({
              type: 'Add commands',
              data: { commands: [...nextCommands] },
            })
          }

          registeredCommands = nextCommands
          flushPendingCommandSelections()
        })

        return commandBarActor
      }

      const serviceImpl: CommandSystemService = {
        get actor() {
          return ensureActor()
        },
        send: (event) => {
          ensureActor()

          if (
            event.type === 'Find and select command' &&
            !commandIsRegistered(event)
          ) {
            pendingCommandSelections = [
              ...pendingCommandSelections.filter(
                (pending) =>
                  pending.data.name !== event.data.name ||
                  pending.data.groupId !== event.data.groupId
              ),
              event,
            ]
            return
          }

          commandBarActor?.send(event)
        },
        useState: () => useSelector(ensureActor(), (state) => state),
      }

      return {
        exports: serviceImpl,
        items: [provide(commandSystemService, serviceImpl)],
        dispose: () => {
          pendingCommandSelections = []
          stopCommandPaletteScopeSync?.()
          // Disposal publishes an empty graph before cleanup, so retain the service
          // used by this actor rather than looking it up after its provider is gone.
          commandPaletteScopeOwner?.removeScope(
            COMMAND_PALETTE_OPEN_COMMAND_SCOPE
          )
          stopCommandsEffect?.()
          commandBarActor?.stop()
        },
      }
    },
  }) satisfies Factory
export const commandsExtension = createCommandsExtension()
export const toolbarCommandsItem = defineFactory({
  dependencies: {
    projectSession: projectSessionObservations,
    userFeatures: userFeaturesObservations,
  },
  key: 'toolbar-commands',
  create: ({
    projectSession: projectSessionInputs,
    userFeatures: userFeaturesInputs,
  }) => {
    const getExecutingEditor = () =>
      untracked(
        () =>
          projectSessionInputs.projectSession.current.value?.project.value
            ?.executingEditor.value ?? undefined
      )
    return {
      items: [
        ...[
          ...createToolbarCommands(
            getExecutingEditor,
            () => userFeaturesInputs.userFeaturesService.current.value
          ),
          ...createAppCommands(getExecutingEditor),
        ].map((command) =>
          contribute(commandsFacet, () => command, {
            key: commandKey(command),
          })
        ),
      ],
    }
  },
}) satisfies Factory
const commandsRegistryItem = [commandsExtension, toolbarCommandsItem]
export default commandsRegistryItem
