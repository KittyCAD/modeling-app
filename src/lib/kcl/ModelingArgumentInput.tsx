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
import { resolveToCodeRef } from '@src/lang/queryAst'
import {
  getEngineRegionSelectionFromPoint,
  normalizeEntityReference,
  getSelectionCountByType,
  canSubmitSelectionArg,
} from '@src/lib/selections'
import { isModelingResponse } from '@src/lib/kcSdkGuards'
import type { KclSession } from '@src/lib/kcl/session'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { Selections } from '@src/machines/modelingSharedTypes'
import { commandScopeService } from '@src/registry/contracts/commands'

const emptySelections: Selections = { graphSelections: [], otherSelections: [] }
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
  useEffect(() => {
    let active = true
    let queue = Promise.resolve()
    const click = (event: MouseEvent) => {
      const video = target.session.element.querySelector('video')
      if (!video || !video.contains(event.target as Node)) return
      const rect = video.getBoundingClientRect()
      queue = queue
        .then(async () => {
          if (!active || currentModel(target) !== snapshot) return
          const result = await target.session.sendSceneCommand({
            type: 'modeling_cmd_req',
            cmd_id: crypto.randomUUID(),
            cmd: {
              type: 'query_entity_type_with_point',
              selected_at_window: {
                x:
                  ((event.clientX - rect.left) / rect.width) * video.videoWidth,
                y:
                  ((event.clientY - rect.top) / rect.height) *
                  video.videoHeight,
              },
              selection_type: 'add',
            },
          })
          if (
            !isModelingResponse(result) ||
            result.resp.data.modeling_response.type !==
              'query_entity_type_with_point'
          )
            return
          const reference = normalizeEntityReference(
            result.resp.data.modeling_response.data.reference
          )
          if (!reference)
            return Promise.reject(new Error('Select geometry in this model'))
          let next: Selections
          if (reference.type === 'region') {
            const parsed = parse(snapshot.contents, wasm)
            if (parsed instanceof Error || !resultIsOk(parsed)) return
            const region = await getEngineRegionSelectionFromPoint(
              reference.region_id,
              snapshot.execState.artifactGraph,
              parsed.program,
              target.session,
              wasm
            )
            if (!region)
              return Promise.reject(
                new Error('Unable to resolve the selected region')
              )
            next = { graphSelections: [], otherSelections: [region] }
          } else {
            const resolved = resolveToCodeRef(
              { entityRef: reference },
              snapshot.execState.artifactGraph
            )
            if (!resolved)
              return Promise.reject(
                new Error('The selected geometry has no editable source')
              )
            next = {
              graphSelections: [{ ...resolved, entityRef: reference }],
              otherSelections: [],
            }
          }
          const parsed = parse(snapshot.contents, wasm)
          if (parsed instanceof Error || !resultIsOk(parsed)) return
          const counts = getSelectionCountByType(
            parsed.program,
            next,
            snapshot.execState.artifactGraph
          )
          if (!canSubmitSelectionArg(counts, arg, next))
            return Promise.reject(
              new Error('This argument does not accept that geometry')
            )
          if (!active || currentModel(target) !== snapshot) return
          setError(undefined)
          form.current?.focus()
          setSelection((previous) =>
            arg.multiple && event.shiftKey
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
        })
        .catch((cause: unknown) => {
          if (active)
            setError(
              cause instanceof Error
                ? cause.message
                : 'Unable to select geometry'
            )
        })
    }
    target.session.element.addEventListener('click', click)
    return () => {
      active = false
      target.session.element.removeEventListener('click', click)
    }
  }, [arg, target, snapshot, wasm])
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
