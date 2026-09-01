import {
  defineRegistryItem,
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provide,
  provideService,
} from '@kittycad/registry'
import { effect } from '@preact/signals-core'
import type { Command } from '@src/lib/commandTypes'
import {
  type CommandBarMachineEvent,
  commandBarMachine,
} from '@src/machines/commandBarMachine'
import {
  type CommandSystemService,
  commandKey,
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

  let commandBarActor: CommandSystemService['actor'] | undefined
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
    item: defineRuntimeRegistryItem({
      id: 'commands-extension',
      providesServices: [provideService(commandSystemService, serviceImpl)],
      dispose: () => {
        pendingCommandSelections = []
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
