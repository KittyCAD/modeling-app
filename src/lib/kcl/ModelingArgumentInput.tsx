import { watchViewerSelection } from '@src/lib/kcl/selection'
import { use, useEffect, useMemo, useRef, useState } from 'react'
import { computed } from '@preact/signals-core'
import {
  CommandKclInput,
  getKclInputValue,
} from '@src/components/CommandBar/CommandKclInput'
import { DefaultArgumentInput } from '@src/components/CommandBar/CommandBarArgument'
import { useApp } from '@src/lib/boot'
import type {
  CommandArgument,
  CommandArgumentInputProps,
  KclCommandValue,
} from '@src/lib/commandTypes'
import { isKclCommandValue } from '@src/lib/commandUtils'
import { currentModel, type ModelingTarget } from '@src/lib/kcl/modelingTarget'
import type { KclModelSnapshot } from '@src/lib/kcl/stdlibExtrude'
import { parse, resultIsOk } from '@src/lang/wasm'
import type { KclSession } from '@src/lib/kcl/session'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { Selections } from '@src/machines/modelingSharedTypes'
import { commandScopeService } from '@src/registry/contracts/commands'

const emptySelections: Selections = {
  graphSelections: [],
  otherSelections: [],
}
export default function ViewerArgumentInput(
  props: CommandArgumentInputProps & {
    targetFor: (args: Record<string, unknown>) => ModelingTarget | undefined
    wasmPromise: Promise<ModuleType>
  }
) {
  const wasm = use(props.wasmPromise)
  const { commands } = useApp()
  const target = props.targetFor(commands.useState().context.argumentsToSubmit)
  if (
    (props.arg.inputType === 'kcl' || props.arg.inputType === 'selection') &&
    !target
  )
    return (
      <p role="alert">
        The model changed. Restart Extrude to use its current geometry.
      </p>
    )
  return target &&
    (props.arg.inputType === 'kcl' || props.arg.inputType === 'selection') ? (
    <ModelingArgumentInput
      key={`${target.id}:${props.arg.name}`}
      {...props}
      target={target}
      wasm={wasm}
    />
  ) : (
    <DefaultArgumentInput {...props} />
  )
}

function ModelingArgumentInput({
  arg,
  onSubmit,
  target,
  wasm,
}: CommandArgumentInputProps & { target: ModelingTarget; wasm: ModuleType }) {
  const { commands, settings, wasmPromise, registry } = useApp()
  const { context } = commands.useState()
  const snapshot = useMemo(() => currentModel(target), [target])
  const model = useMemo(() => {
    if (!snapshot) return
    const parsed = parse(snapshot.contents, wasm)
    if (parsed instanceof Error || !resultIsOk(parsed)) return
    return {
      ast: parsed.program,
      astSignal: computed(() => parsed.program),
      codeSignal: computed(() => snapshot.contents),
      variablesSignal: computed(() => snapshot.execState.variables),
      rustContext: {
        wasmInstancePromise: wasmPromise,
        evaluateExpression: async (
          ast: Parameters<KclSession['evaluateExpression']>[0]
        ) => {
          if (currentModel(target) !== snapshot)
            return Promise.reject(
              new Error('The model changed while entering an argument')
            )
          return target.session.evaluateExpression(ast)
        },
        waitForAllEngineModelingCommands:
          target.session.waitForAllEngineModelingCommands,
      },
    }
  }, [snapshot, target, wasm, wasmPromise])
  const [value, setValue] = useState(() =>
    arg.inputType === 'kcl'
      ? getKclInputValue(
          arg,
          context.argumentsToSubmit[arg.name] ??
            (typeof arg.defaultValue === 'function'
              ? arg.defaultValue(context)
              : arg.defaultValue)
        )
      : ''
  )
  const [resolved, setResolved] = useState<KclCommandValue>()
  const [valid, setValid] = useState(false)
  if (!model || !snapshot)
    return <p role="alert">Execute the model before entering arguments.</p>
  if (arg.inputType === 'selection')
    return (
      <ViewerSelectionInput
        arg={arg}
        target={target}
        snapshot={snapshot}
        wasm={wasm}
        onSubmit={onSubmit}
      />
    )
  if (arg.inputType !== 'kcl') return null
  return (
    <form
      id="arg-form"
      data-can-submit={valid && Boolean(resolved)}
      onSubmit={(event) => {
        event.preventDefault()
        if (valid && resolved) onSubmit(resolved)
      }}
    >
      <CommandKclInput
        key={arg.name}
        kclManager={model}
        settings={settings}
        wasmPromise={wasmPromise}
        commandScopes={registry.optional(commandScopeService)}
        name={arg.name}
        arg={arg}
        label={arg.displayName ?? arg.name}
        value={value}
        submittedValue={context.argumentsToSubmit[arg.name]}
        selectionRanges={emptySelections}
        autoFocus
        onChange={(change) => {
          if (change.source === 'edit' && typeof change.value === 'string')
            setValue(change.value)
          if (change.source === 'calculation')
            setResolved(
              isKclCommandValue(change.value) ? change.value : undefined
            )
        }}
        onValidationChange={(state) =>
          setValid(state.canSubmit && !state.isChecking)
        }
      />
    </form>
  )
}

function ViewerSelectionInput({
  arg,
  target,
  snapshot,
  wasm,
  onSubmit,
}: {
  arg: Extract<CommandArgument<unknown>, { inputType: 'selection' }> & {
    name: string
  }
  target: ModelingTarget
  snapshot: KclModelSnapshot
  wasm: ModuleType
  onSubmit: (value: unknown) => void
}) {
  const form = useRef<HTMLFormElement>(null)
  const [selection, setSelection] = useState<Selections>(emptySelections)
  const [error, setError] = useState<string>()
  useEffect(
    () =>
      watchViewerSelection({
        target,
        snapshot,
        wasm,
        arg,
        onSelect: (next, add) => {
          setError(undefined)
          form.current?.focus()
          setSelection((previous) =>
            add
              ? {
                  graphSelections: [
                    ...previous.graphSelections,
                    ...next.graphSelections,
                  ],
                  otherSelections: [
                    ...previous.otherSelections,
                    ...next.otherSelections,
                  ],
                }
              : next
          )
        },
        onError: setError,
      }),
    [arg, target, snapshot, wasm]
  )
  const count =
    selection.graphSelections.length + selection.otherSelections.length
  return (
    <form
      id="arg-form"
      ref={form}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && count) {
          event.preventDefault()
          onSubmit(selection)
        }
      }}
      data-can-submit={count > 0}
      onSubmit={(event) => {
        event.preventDefault()
        if (count) onSubmit(selection)
      }}
      className="px-4 py-3"
    >
      <p>
        Click {arg.displayName?.toLowerCase() ?? arg.name} in the model
        {arg.multiple ? '; Shift-click to add more' : ''}.
      </p>
      <p role="status">
        {count ? `${count} selected` : 'Nothing selected yet'}
      </p>
      {error && <p role="alert">{error}</p>}
    </form>
  )
}
