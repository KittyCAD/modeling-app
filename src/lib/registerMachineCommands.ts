import type { Actor, AnyStateMachine, EventFrom, StateFrom } from 'xstate'
import type {
  Command,
  StateMachineCommandSetConfig,
  StateMachineCommandSetSchema,
} from '@src/lib/commandTypes'
import { createMachineCommand } from '@src/lib/createMachineCommand'
import type { CommandBarActorType } from '@src/machines/commandBarMachine'

/** Register the existing machine command definitions against a supplied command actor, with readiness supplied by its owner. */
export function registerMachineCommands<
  T extends AnyStateMachine,
  S extends StateMachineCommandSetSchema<T>,
>(
  commands: Pick<CommandBarActorType, 'send'>,
  input: {
    machineId: T['id']
    state: StateFrom<T>
    send: (event: EventFrom<T>) => void
    actor: Actor<T>
    commandBarConfig?: StateMachineCommandSetConfig<T, S>
    getDefaultDescription?: (type: EventFrom<T>['type']) => string | undefined
    scopes: Command['scopes']
    onCancel?: () => void
    forceDisable: boolean
    showExperimentalCommands: boolean
  }
) {
  const registered = createMachineCommands<T, S>(input)
  commands.send({ type: 'Add commands', data: { commands: registered } })
  return () =>
    commands.send({ type: 'Remove commands', data: { commands: registered } })
}

export function createMachineCommands<
  T extends AnyStateMachine,
  S extends StateMachineCommandSetSchema<T>,
>(input: {
  machineId: T['id']
  state: StateFrom<T>
  send: (event: EventFrom<T>) => void
  actor: Actor<T>
  commandBarConfig?: StateMachineCommandSetConfig<T, S>
  getDefaultDescription?: (type: EventFrom<T>['type']) => string | undefined
  scopes: Command['scopes']
  onCancel?: () => void
  forceDisable: boolean
  showExperimentalCommands: boolean
}) {
  return Object.keys(input.commandBarConfig ?? {})
    .flatMap((type) =>
      createMachineCommand<T, S>({
        groupId: input.machineId,
        type: type as EventFrom<T>['type'],
        state: input.state,
        send: input.send,
        actor: input.actor,
        commandBarConfig: input.commandBarConfig,
        getDefaultDescription: input.getDefaultDescription,
        defaultScopes: input.scopes,
        onCancel: input.onCancel,
        forceDisable: input.forceDisable,
        showExperimentalCommands: input.showExperimentalCommands,
      })
    )
    .map((command) =>
      command
        ? {
            ...command,
            useModelingDialog:
              command.groupId === 'modeling' && !command.forceCommandBar,
          }
        : command
    )
    .filter((command) => command !== null) as Command[]
}
