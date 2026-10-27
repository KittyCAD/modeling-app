import { use, useMemo, useState } from 'react'
import { useSelector } from '@xstate/react'
import type { AnyStateMachine, SnapshotFrom } from 'xstate'
import { CommandPathInput } from '@src/components/CommandBar/CommandPathInput'
import { noAutofillFormProps } from '@src/lib/autofill'
import { useApp } from '@src/lib/boot'
import type { CommandArgument } from '@src/lib/commandTypes'

// TODO: remove the need for this selector once we decouple all actors from React
const machineContextSelector = (snapshot?: SnapshotFrom<AnyStateMachine>) =>
  snapshot?.context

function CommandBarPathInput({
  arg,
  stepBack,
  onSubmit,
}: {
  arg: CommandArgument<unknown> & { inputType: 'path'; name: string }
  stepBack: () => void
  onSubmit: (event: unknown) => void
}) {
  const { wasmPromise, commands } = useApp()
  const wasmInstance = use(wasmPromise)
  const commandBarState = commands.useState()
  const argMachineContext = useSelector(
    arg.machineActor,
    machineContextSelector
  )
  const defaultValue = useMemo(
    () =>
      typeof arg.defaultValue === 'function'
        ? arg.defaultValue(
            commandBarState.context,
            argMachineContext,
            wasmInstance
          )
        : arg.defaultValue,
    [arg, commandBarState.context, argMachineContext, wasmInstance]
  )
  const [value, setValue] = useState(() => {
    const initial =
      commandBarState.context.argumentsToSubmit[arg.name] ?? defaultValue
    return typeof initial === 'string' || initial instanceof File
      ? initial
      : undefined
  })

  return (
    <form
      {...noAutofillFormProps}
      id="arg-form"
      onSubmit={(event) => {
        event.preventDefault()
        if (value) onSubmit(value)
      }}
    >
      <div className="flex items-center mx-4 my-4 border-b border-b-chalkboard-100 dark:border-b-chalkboard-80">
        <label
          htmlFor="cmd-bar-path-input"
          data-testid="cmd-bar-arg-name"
          className="capitalize px-2 py-1 bg-chalkboard-100 dark:bg-chalkboard-80 text-chalkboard-10"
        >
          {arg.displayName || arg.name}
        </label>
        <CommandPathInput
          id="cmd-bar-path-input"
          value={value}
          filters={arg.filters}
          required
          autoOpen
          onChange={setValue}
          onKeyDown={(event) => {
            if (event.key === 'Backspace' && event.metaKey) stepBack()
          }}
        />
      </div>
    </form>
  )
}

export default CommandBarPathInput
