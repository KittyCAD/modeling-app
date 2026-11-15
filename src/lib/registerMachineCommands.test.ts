import { expect, it, vi } from 'vitest'
import { assign, createActor, setup } from 'xstate'
import { MachineManager } from '@src/lib/MachineManager'
import { registerMachineCommands } from '@src/lib/registerMachineCommands'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { commandBarMachine } from '@src/machines/commandBarMachine'
import { GLOBAL_COMMAND_SCOPES } from '@src/registry/contracts/commands'

vi.mock('@src/lib/boot', () => ({ app: {} }))

const machine = setup({
  types: { events: {} as { type: 'Perform' } },
}).createMachine({
  id: 'modeling',
  context: { completed: 0 },
  on: {
    Perform: {
      actions: assign({ completed: ({ context }) => context.completed + 1 }),
    },
  },
})

function fixture(forceDisable = false) {
  const actor = createActor(machine).start()
  const commands = createActor(commandBarMachine, {
    input: {
      commands: [],
      wasmInstancePromise: Promise.resolve({} as ModuleType),
      machineManager: new MachineManager(),
    },
  }).start()
  const unregister = registerMachineCommands(commands, {
    machineId: machine.id,
    actor,
    state: actor.getSnapshot(),
    send: (event) => actor.send(event),
    commandBarConfig: { Perform: { description: 'Perform an operation' } },
    scopes: GLOBAL_COMMAND_SCOPES,
    forceDisable,
    showExperimentalCommands: false,
  })
  return { actor, commands, unregister }
}

it('routes the same command to its owning actor and removes only that view’s registration', () => {
  const first = fixture(),
    second = fixture()
  try {
    const command = first.commands.getSnapshot().context.commands[0]
    command.onSubmit?.()
    expect(first.actor.getSnapshot().context.completed).toBe(1)
    expect(second.actor.getSnapshot().context.completed).toBe(0)
    expect(command.useModelingDialog).toBe(true)
    first.unregister()
    expect(first.commands.getSnapshot().context.commands).toEqual([])
    const siblingCommand = second.commands.getSnapshot().context.commands[0]
    siblingCommand.onSubmit?.()
    expect(second.actor.getSnapshot().context.completed).toBe(1)
  } finally {
    for (const view of [first, second]) {
      view.unregister()
      view.commands.stop()
      view.actor.stop()
    }
  }
})

it('keeps readiness local to the command owner', () => {
  const first = fixture(true),
    second = fixture()
  try {
    expect(first.commands.getSnapshot().context.commands[0].disabled).toBe(true)
    expect(second.commands.getSnapshot().context.commands[0].disabled).toBe(
      false
    )
  } finally {
    for (const view of [first, second]) {
      view.unregister()
      view.commands.stop()
      view.actor.stop()
    }
  }
})
