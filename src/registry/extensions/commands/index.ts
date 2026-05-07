import {
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provideService,
} from '@kittycad/registry'
import { effect } from '@preact/signals-core'
import type { Command } from '@src/lib/commandTypes'
import { commandBarMachine } from '@src/machines/commandBarMachine'
import {
  type CommandSystemService,
  commandSystemService,
  commandsValueSpec,
} from '@src/registry/contracts/commands'
import { machineManagerService } from '@src/registry/contracts/machineManager'
import { wasmPromiseValueSpec } from '@src/registry/contracts/wasm'
import { useSelector } from '@xstate/react'
import { createActor } from 'xstate'

const commandsExtension = defineRegistryItemFactory((ctx) => {
  const machineManagerSignal = ctx.services.signal(machineManagerService)
  const wasmPromiseSignal = ctx.valueSpecs.signal(wasmPromiseValueSpec)
  const commandsSignal = ctx.valueSpecs.signal(commandsValueSpec)

  let commandBarActor: CommandSystemService['actor'] | undefined
  let stopCommandsEffect: (() => void) | undefined
  let registeredCommands: readonly Command[] = []

  const ensureActor = () => {
    if (commandBarActor) {
      return commandBarActor
    }

    const machineManager = machineManagerSignal.value
    if (!machineManager) {
      throw new Error('Missing machine manager service.')
    }

    const wasmPromise = wasmPromiseSignal.value
    if (!wasmPromise) {
      throw new Error('Missing WASM promise registry value.')
    }

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
    })

    return commandBarActor
  }

  const serviceImpl: CommandSystemService = {
    get actor() {
      return ensureActor()
    },
    send: ((...args: Parameters<CommandSystemService['send']>) =>
      ensureActor().send(...args)) as CommandSystemService['send'],
    useState: () => useSelector(ensureActor(), (state) => state),
  }

  return {
    item: defineRuntimeRegistryItem({
      id: 'commands-extension',
      providesServices: [provideService(commandSystemService, serviceImpl)],
      dispose: () => {
        stopCommandsEffect?.()
        commandBarActor?.stop()
      },
    }),
  }
}, 'commands-extension')

export default commandsExtension
