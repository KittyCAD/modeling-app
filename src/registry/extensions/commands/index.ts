import {
  defineRegistryItem,
  defineRegistryItemFactory,
  provide,
  provideService,
} from '@kittycad/registry'
import { effect, signal, untracked } from '@preact/signals-core'
import type { Command } from '@src/lib/commandTypes'
import { isModelingDialogCommand } from '@src/lib/commandUtils'
import { uuidv4 } from '@src/lib/utils'
import {
  type CommandBarMachineEvent,
  commandBarMachine,
} from '@src/machines/commandBarMachine'
import {
  COMMAND_PALETTE_OPEN_COMMAND_SCOPE,
  type CommandDialogSession,
  type CommandSystemService,
  commandKey,
  commandScopeService,
  commandSystemService,
  commandsValueSpec,
} from '@src/registry/contracts/commands'
import { machineManagerService } from '@src/registry/contracts/machineManager'
import { wasmPromiseValueSpec } from '@src/registry/contracts/wasm'
import { useSelector } from '@xstate/react'
import { createActor } from 'xstate'
import { appCommands } from './appCommands'
import { toolbarCommands } from './toolbarCommands'

type FindAndSelectCommandEvent = Extract<
  CommandBarMachineEvent,
  { type: 'Find and select command' }
>

export const commandsExtension = defineRegistryItemFactory((ctx) => {
  const commandsSignal = ctx.valueSpecs.signal(commandsValueSpec)
  const dialogSession = signal<CommandDialogSession | undefined>(undefined)

  let commandBarActor: CommandSystemService['actor'] | undefined
  let stopCommandStateSync: (() => void) | undefined
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
    let previousArguments =
      commandBarActor.getSnapshot().context.argumentsToSubmit
    const commandStateSubscription = commandBarActor.subscribe({
      next: (snapshot) => {
        untracked(syncCommandPaletteScope)
        const args = snapshot.context.argumentsToSubmit
        const changed = args !== previousArguments
        previousArguments = args
        if (!isModelingDialogCommand(snapshot.context.selectedCommand)) {
          dialogSession.value = undefined
        } else if (
          changed &&
          !snapshot.matches('Checking Arguments for Dialog')
        ) {
          // Submission also replaces arguments; only a new command resets the draft.
          dialogSession.value = { id: uuidv4() }
        }
      },
      complete: () => {
        dialogSession.value = undefined
      },
    })
    stopCommandStateSync = () => commandStateSubscription.unsubscribe()

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
    get dialogSession() {
      ensureActor()
      return dialogSession
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
    providesServices: [provideService(commandSystemService, serviceImpl)],
    dispose: () => {
      pendingCommandSelections = []
      stopCommandStateSync?.()
      ctx.services
        .optional(commandScopeService)
        ?.removeScope(COMMAND_PALETTE_OPEN_COMMAND_SCOPE)
      stopCommandsEffect?.()
      commandBarActor?.stop()
      dialogSession.value = undefined
    },
  }
}, 'commands-extension')

const toolbarCommandsItem = defineRegistryItem({
  id: 'toolbar-commands',
  provides: [...toolbarCommands, ...appCommands].map((command) =>
    provide(commandsValueSpec, command, {
      key: commandKey(command),
    })
  ),
})

const commandsRegistryItem = defineRegistryItem({
  id: 'commands',
  uses: [commandsExtension, toolbarCommandsItem],
})

export default commandsRegistryItem
