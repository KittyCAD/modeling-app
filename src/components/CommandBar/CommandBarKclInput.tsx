import { use, useEffect, useMemo, useState } from 'react'
import { useSelector } from '@xstate/react'
import type { AnyStateMachine, SnapshotFrom } from 'xstate'
import {
  CommandKclInput,
  getKclInputValue,
  type CommandKclArgument,
} from '@src/components/CommandBar/CommandKclInput'
import { MarkdownText } from '@src/components/MarkdownText'
import { useModelingContext } from '@src/hooks/useModelingContext'
import type { KclManager } from '@src/lang/KclManager'
import { noAutofillFormProps } from '@src/lib/autofill'
import { useApp } from '@src/lib/boot'
import type { KclCommandValue } from '@src/lib/commandTypes'
import { isKclCommandValue } from '@src/lib/commandUtils'
import useHotkeyWrapper from '@src/lib/hotkeyWrapper'
import { commandScopeService } from '@src/registry/contracts/commands'
import toast from 'react-hot-toast'

const machineContextSelector = (snapshot?: SnapshotFrom<AnyStateMachine>) =>
  snapshot?.context

function CommandBarKclInput({
  arg,
  stepBack,
  onSubmit,
  executingEditor,
}: {
  arg: CommandKclArgument & { name: string }
  stepBack: () => void
  onSubmit: (value: unknown) => void
  executingEditor: KclManager
}) {
  const { commands, settings, wasmPromise, registry } = useApp()
  const wasmInstance = use(wasmPromise)
  const { context } = commands.useState()
  const {
    context: { selectionRanges },
  } = useModelingContext()
  const machineContext = useSelector(arg.machineActor, machineContextSelector)
  const submittedValue = context.argumentsToSubmit[arg.name]
  const defaultValue = useMemo(
    () =>
      typeof arg.defaultValue === 'function'
        ? arg.defaultValue(context, machineContext, wasmInstance)
        : arg.defaultValue,
    [arg, context, machineContext, wasmInstance]
  )
  const initialValue = getKclInputValue(arg, submittedValue ?? defaultValue)
  const [value, setValue] = useState(initialValue)
  const [resolvedValue, setResolvedValue] = useState<KclCommandValue>()
  const [canSubmit, setCanSubmit] = useState(false)
  useEffect(() => {
    setValue(initialValue)
  }, [arg.name, initialValue])
  useHotkeyWrapper(
    ['esc'],
    () => commands.send({ type: 'Close' }),
    executingEditor,
    {
      enableOnFormTags: true,
      enableOnContentEditable: true,
    }
  )

  function submit() {
    if (!canSubmit || !resolvedValue) {
      toast.error('Unable to submit command.')
      return
    }
    onSubmit(resolvedValue)
  }

  return (
    <form
      {...noAutofillFormProps}
      id="arg-form"
      className="mb-2"
      data-can-submit={canSubmit && Boolean(resolvedValue)}
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Backspace' && event.metaKey) {
          event.preventDefault()
          stepBack()
        }
      }}
    >
      <CommandKclInput
        key={arg.name}
        kclManager={executingEditor}
        settings={settings}
        wasmPromise={wasmPromise}
        commandScopes={registry.optional(commandScopeService)}
        name={arg.name}
        arg={arg}
        label={arg.displayName || arg.name}
        description={
          arg.description && (
            <MarkdownText
              text={arg.description}
              className="mx-4 mb-4 select-text text-sm leading-relaxed text-chalkboard-70 dark:text-chalkboard-40 parsed-markdown [&_*]:select-text [&_strong]:font-semibold [&_strong]:text-chalkboard-90 dark:[&_strong]:text-chalkboard-20"
            />
          )
        }
        value={value}
        submittedValue={submittedValue}
        nodeToEdit={context.argumentsToSubmit.nodeToEdit}
        variableName={
          typeof arg.variableName === 'function'
            ? arg.variableName(context, machineContext)
            : arg.variableName
        }
        selectionRanges={selectionRanges}
        autoFocus
        onChange={(change) => {
          if (change.source === 'edit' && typeof change.value === 'string')
            setValue(change.value)
          if (change.source === 'calculation')
            setResolvedValue(
              isKclCommandValue(change.value) ? change.value : undefined
            )
        }}
        onValidationChange={(state) =>
          setCanSubmit(state.canSubmit && !state.isChecking)
        }
      />
    </form>
  )
}
export default CommandBarKclInput
