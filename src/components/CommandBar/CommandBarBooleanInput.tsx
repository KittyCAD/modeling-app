import { useSignals } from '@preact/signals-react/runtime'
import { use } from 'react'
import CommandArgOptionInput from '@src/components/CommandBar/CommandArgOptionInput'
import { evaluateCommandArgumentFlags } from '@src/components/CommandBar/utils'
import type { KclManager } from '@src/lang/KclManager'
import { useApp } from '@src/lib/boot'
import { getBooleanOptions, resolveBooleanValue } from '@src/lib/booleanInput'
import type { CommandArgument } from '@src/lib/commandTypes'
import { isErr, reportRejection, trap } from '@src/lib/trap'

export function CommandBarBooleanInput({
  arg,
  kclManager,
  stepBack,
  onSubmit,
}: {
  arg: Extract<CommandArgument<unknown>, { inputType: 'boolean' }> & {
    name: string
  }
  kclManager: KclManager
  stepBack: () => void
  onSubmit: (value: unknown) => void
}) {
  useSignals()
  const { commands, wasmPromise } = useApp()
  const wasmInstance = use(wasmPromise)
  const { context } = commands.useState()
  const options = getBooleanOptions({
    required: evaluateCommandArgumentFlags(arg, context).isRequired,
    currentValue: context.argumentsToSubmit[arg.name],
    ast: kclManager.astSignal.value,
    variables: kclManager.variablesSignal.value,
    nodeToEdit: context.argumentsToSubmit.nodeToEdit,
    wasmInstance,
  })

  async function submit(value: unknown) {
    const resolved = await resolveBooleanValue(value, kclManager.rustContext)
    const current = commands.actor.getSnapshot().context
    if (
      current.selectedCommand !== context.selectedCommand ||
      current.argumentsToSubmit !== context.argumentsToSubmit ||
      current.currentArgument?.name !== arg.name
    )
      return
    if (isErr(resolved)) {
      trap(resolved)
      return
    }
    onSubmit(resolved)
  }

  return (
    <CommandArgOptionInput
      arg={{ ...arg, inputType: 'options', options }}
      argName={arg.displayName || arg.name}
      stepBack={stepBack}
      onSubmit={(value) => {
        submit(value).catch(reportRejection)
      }}
      placeholder="Select an option"
    />
  )
}
