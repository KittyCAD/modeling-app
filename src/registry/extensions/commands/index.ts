import { createContextualCommands } from '@src/lib/commands/contextual'
import {
  defineRegistryItem,
  defineRegistryItemFactory,
  provide,
  provideService,
} from '@kittycad/registry'
import { effect, untracked } from '@preact/signals-core'
import type { Command } from '@src/lib/commandTypes'
import {
  type CommandBarMachineEvent,
  commandBarMachine,
} from '@src/machines/commandBarMachine'
import {
  COMMAND_PALETTE_OPEN_COMMAND_SCOPE,
  type CommandSystemService,
  commandKey,
  contextualCommandsService,
  commandScopeService,
  commandSystemService,
  commandsValueSpec,
} from '@src/registry/contracts/commands'
import { projectSession } from '@src/registry/contracts/projectSession'
import { userFeaturesService } from '@src/registry/contracts/userFeatures'
import { machineManagerService } from '@src/registry/contracts/machineManager'
import { wasmPromiseValueSpec } from '@src/registry/contracts/wasm'
import { useSelector } from '@xstate/react'
import { createActor } from 'xstate'
import { createAppCommands } from './appCommands'
import { createToolbarCommands } from './toolbarCommands'

type FindAndSelectCommandEvent = Extract<
  CommandBarMachineEvent,
  { type: 'Find and select command' }
>

export const commandsExtension = defineRegistryItemFactory((ctx) => {
  const commandsSignal = ctx.valueSpecs.signal(commandsValueSpec)
  const contextual = createContextualCommands()
  let ownedScopes: readonly string[] = []

  let commandBarActor: CommandSystemService['actor'] | undefined
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

    const readySelections = pendingCommandSelections.filter(commandIsRegistered)
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

    const machineManager = ctx.services.get(machineManagerService).manager
    const wasmPromise =
      ctx.valueSpecs.get(wasmPromiseValueSpec) ??
      Promise.reject(new Error('Missing WASM promise registry value.'))

    commandBarActor = createActor(commandBarMachine, {
      input: {
        commands: [],
        wasmInstancePromise: wasmPromise,
        machineManager,
      },
    }).start()

    const syncCommandPaletteScope = () => {
      const commandScopes = ctx.services.optional(commandScopeService)
      if (!commandScopes || !commandBarActor) {
        return
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
      const source = contextual.active.value
      const nextCommands = [
        ...new Map(
          [...commandsSignal.value, ...(source?.commands.value ?? [])].map(
            (command) => [commandKey(command), command]
          )
        ).values(),
      ]
      const nextScopes = source?.scopes.value ?? []
      untracked(() => {
        const scopes = ctx.services.optional(commandScopeService)
        for (const scope of ownedScopes)
          if (!nextScopes.includes(scope)) scopes?.removeScope(scope)
        for (const scope of nextScopes)
          if (!ownedScopes.includes(scope)) scopes?.applyScope(scope)
        ownedScopes = nextScopes

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
    id: 'commands-extension',
    providesServices: [
      provideService(commandSystemService, serviceImpl),
      provideService(contextualCommandsService, contextual),
    ],
    dispose: () => {
      contextual.dispose()
      for (const scope of ownedScopes)
        ctx.services.optional(commandScopeService)?.removeScope(scope)
      pendingCommandSelections = []
      stopCommandPaletteScopeSync?.()
      ctx.services
        .optional(commandScopeService)
        ?.removeScope(COMMAND_PALETTE_OPEN_COMMAND_SCOPE)
      stopCommandsEffect?.()
      commandBarActor?.stop()
    },
  }
}, 'commands-extension')

export const toolbarCommandsItem = defineRegistryItemFactory((ctx) => {
  const getExecutingEditor = () =>
    untracked(
      () =>
        ctx.services.optional(projectSession)?.project.value?.executingEditor
          .value ?? undefined
    )
  return {
    id: 'toolbar-commands',
    provides: [
      ...createToolbarCommands(getExecutingEditor, () =>
        ctx.services.optional(userFeaturesService)
      ),
      ...createAppCommands(getExecutingEditor),
    ].map((command) =>
      provide(commandsValueSpec, command, {
        key: commandKey(command),
      })
    ),
  }
}, 'toolbar-commands')

const commandsRegistryItem = defineRegistryItem({
  id: 'commands',
  uses: [commandsExtension, toolbarCommandsItem],
})

export default commandsRegistryItem
