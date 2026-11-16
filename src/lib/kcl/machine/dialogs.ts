import { computed, effect, type ReadonlySignal } from '@preact/signals-core'
import { waitFor } from 'xstate'
import type { CommandSystemService } from '@src/registry/contracts/commands'
import type { ModelingViewRuntime } from '@src/lib/kcl/registry/contract'
import { isErr } from '@src/lib/trap'

/** Keep the existing Form/Code argument editors and dialog-owned picking, but submit through the machine's registered command. */
export function bindMachineDialogs(
  context: ModelingViewRuntime,
  commands: CommandSystemService,
  experimental: boolean,
  state: ReadonlySignal<
    ReturnType<CommandSystemService['actor']['getSnapshot']>
  >
) {
  const active = context.tools.active
  const selected = computed(() => {
    const current = state.value
    return current.matches('Closed') ||
      current.context.argumentsToSubmit.nodeToEdit
      ? undefined
      : current.context.selectedCommand
  })
  const supported = computed(() => {
    const command = selected.value
    return command?.groupId === 'modeling'
      ? context.tools.definitions.value.find(
          (tool) => tool.name === command.name
        )
      : undefined
  })
  let generation = 0
  const stop = effect(() => {
    const command = selected.value,
      tool = supported.value
    const ticket = ++generation
    active.peek()?.cancel()
    active.value = undefined
    if (!command || !tool) return
    context.tools.error.value = undefined
    const current = () => ticket === generation && selected.peek() === command
    void tool
      .createDialog(
        context,
        experimental,
        () => {
          if (current()) commands.send({ type: 'Close' })
        },
        current,
        async (values) => {
          if (!current())
            return new Error('The command changed before submission.')
          commands.send({
            type: 'Submit command from dialog',
            data: { argumentsToSubmit: values },
          })
          const finished = await waitFor(
            commands.actor,
            (snapshot) =>
              snapshot.matches('Closed') ||
              !!snapshot.context.reviewValidationError ||
              snapshot.context.selectedCommand !== command
          )
          return finished.context.reviewValidationError
            ? new Error(finished.context.reviewValidationError)
            : undefined
        }
      )
      .then((dialog) => {
        if (isErr(dialog)) {
          if (current()) context.tools.error.value = dialog
          return
        }
        if (!current()) dialog.cancel()
        else active.value = dialog
      })
      .catch((cause) => {
        if (current())
          context.tools.error.value = isErr(cause)
            ? cause
            : new Error('Unable to open the command dialog', { cause })
      })
    return () => {
      generation++
      active.peek()?.cancel()
      active.value = undefined
    }
  })
  return {
    active,
    supported,
    dispose: () => {
      stop()
      generation++
      active.peek()?.cancel()
      active.value = undefined
    },
  }
}
