import {
  defineRegistryItem,
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provide,
  provideService,
} from '@kittycad/registry'
import { effect, untracked } from '@preact/signals-core'
import type { Command } from '@src/lib/commandTypes'
import { commandBarMachine } from '@src/machines/commandBarMachine'
import {
  COMMAND_PALETTE_OPEN_COMMAND_SCOPE,
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

export const commandsExtension = defineRegistryItemFactory((ctx) => {
  const commandsSignal = ctx.valueSpecs.signal(commandsValueSpec)

  let commandBarActor: CommandSystemService['actor'] | undefined
  let stopCommandPaletteScopeSync: (() => void) | undefined
  let stopCommandsEffect: (() => void) | undefined
  let registeredCommands: readonly Command[] = []

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
    })

    return commandBarActor
  }

  const serviceImpl: CommandSystemService = {
    get actor() {
      return ensureActor()
    },
    send: (...args: Parameters<CommandSystemService['send']>) =>
      ensureActor().send(...args),
    useState: () => useSelector(ensureActor(), (state) => state),
  }

  return {
    item: defineRuntimeRegistryItem({
      id: 'commands-extension',
      providesServices: [provideService(commandSystemService, serviceImpl)],
      dispose: () => {
        stopCommandPaletteScopeSync?.()
        ctx.services
          .optional(commandScopeService)
          ?.removeScope(COMMAND_PALETTE_OPEN_COMMAND_SCOPE)
        stopCommandsEffect?.()
        commandBarActor?.stop()
      },
    }),
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
