import { useSignals } from '@preact/signals-react/runtime'
import { Draggable } from '@kittycad/ui-components'
import type { RefObject } from 'react'
import { useEffect, useRef, useState } from 'react'
import decamelize from 'decamelize'
import {
  CommandKclInput,
  getKclInputValue,
} from '@src/components/CommandBar/CommandKclInput'
import { CustomIcon } from '@src/components/CustomIcon'
import { MarkdownText } from '@src/components/MarkdownText'
import type { KclManager } from '@src/lang/KclManager'
import type {
  AppCommandSystem,
  AppLayoutSystem,
  AppSettingsSystem,
} from '@src/lib/app'
import { getSelectionTypeDisplayText, isSelections } from '@src/lib/selections'
import { isErr, trap } from '@src/lib/trap'
import { capitaliseFC } from '@src/lib/utils'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { Selections } from '@src/machines/modelingSharedTypes'
import type { CommandScopeService } from '@src/registry/contracts/commands'
import type { EngineSceneViewExtensionProps } from '@src/registry/contracts/engineScene'
import {
  fieldText,
  getDialogFields,
  hasValue,
  initializeArguments,
  resolveArguments,
  type DialogField,
} from '@src/components/ModelingDialog/arguments'
import { useDialogSelection } from '@src/components/ModelingDialog/useDialogSelection'
import { useCodePreview } from '@src/components/ModelingDialog/useCodePreview'

export default function ModelingDialog({
  containerRef,
  kclManager,
  commands,
  settings,
  layout,
  wasmPromise,
  commandScopes,
  selectionRanges,
  modelingSend,
}: {
  containerRef: RefObject<HTMLElement | null>
  kclManager: KclManager
  commands: AppCommandSystem
  settings: AppSettingsSystem
  layout: AppLayoutSystem
  wasmPromise: Promise<ModuleType>
  commandScopes?: CommandScopeService
  selectionRanges: Selections
  modelingSend: EngineSceneViewExtensionProps['modelingSend']
}) {
  useSignals()
  const state = commands.useState()
  const { selectedCommand: command } = state.context
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [validity, setValidity] = useState<Record<string, boolean>>({})
  const [initializing, setInitializing] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const mounted = useRef(true)
  const initialContext = useRef(state.context)
  const fields = getDialogFields({
    ...state.context,
    argumentsToSubmit: { ...state.context.argumentsToSubmit, ...values },
  })
  const save = (name: string, value: unknown) =>
    setValues((previous) => ({ ...previous, [name]: value }))
  const selection = useDialogSelection({
    context: state.context,
    fields,
    values,
    save,
    kclManager,
    wasmPromise,
    selectionRanges,
    modelingSend,
  })
  const context = {
    ...state.context,
    argumentsToSubmit: {
      ...state.context.argumentsToSubmit,
      ...selection.draft,
    },
  }
  const visible = getDialogFields(context)
  const firstFieldName = visible.find(
    ({ arg }) =>
      !arg.dialog?.advanced &&
      !(arg.inputType === 'selection' && context.argumentsToSubmit.nodeToEdit)
  )?.name

  useEffect(() => {
    let cancelled = false
    mounted.current = true
    void initializeArguments(initialContext.current)
      .then((defaults) => {
        if (!cancelled) {
          setValues((previous) => ({ ...defaults, ...previous }))
          setInitializing(false)
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          trap(error)
          setInitializing(false)
        }
      })
    return () => {
      cancelled = true
      mounted.current = false
    }
  }, [])

  const checking = state.matches('Checking Arguments for Dialog')
  const invalid = visible.some(({ name, arg, required }) => {
    if (arg.inputType === 'kcl') return validity[name] === false
    return required && !hasValue(context.argumentsToSubmit[name])
  })
  const codePreview = useCodePreview({
    context: state.context,
    values,
    activeName: selection.activeName,
    selectionRanges: selection.selectionRanges,
    incomplete: initializing || invalid,
    kclManager,
    layout,
  })

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!command || initializing || submitting || checking || invalid) return
    const isCurrent = () => {
      const current = commands.actor.getSnapshot().context
      return (
        mounted.current &&
        current.selectedCommand === command &&
        current.argumentsToSubmit === state.context.argumentsToSubmit
      )
    }
    setSubmitting(true)
    try {
      const resolved = await resolveArguments(
        state.context,
        selection.draft,
        kclManager.rustContext,
        kclManager.astSignal.value,
        kclManager.artifactGraph
      )
      if (!isCurrent()) return
      if (isErr(resolved)) {
        trap(resolved)
        return
      }
      commands.send({
        type: 'Submit command from dialog',
        data: { argumentsToSubmit: resolved },
      })
    } catch (error) {
      if (isCurrent()) trap(error)
    } finally {
      if (mounted.current) setSubmitting(false)
    }
  }

  function renderField({ name, arg, required }: DialogField) {
    const label =
      arg.displayName || capitaliseFC(decamelize(name, { separator: ' ' }))
    const value = context.argumentsToSubmit[name]
    const description = arg.description && (
      <MarkdownText
        text={arg.description}
        className="parsed-markdown text-xs text-chalkboard-70 dark:text-chalkboard-40"
      />
    )
    const machineContext = arg.machineActor?.getSnapshot().context
    if (arg.inputType === 'kcl')
      return (
        <CommandKclInput
          key={name}
          kclManager={kclManager}
          settings={settings}
          wasmPromise={wasmPromise}
          commandScopes={commandScopes}
          name={name}
          arg={arg}
          label={label}
          description={description}
          placeholder={required ? undefined : 'Use defaults'}
          isRequired={required}
          inline={false}
          autoFocus={name === firstFieldName}
          value={getKclInputValue(arg, value)}
          submittedValue={state.context.argumentsToSubmit[name]}
          nodeToEdit={state.context.argumentsToSubmit.nodeToEdit}
          variableName={
            typeof arg.variableName === 'function'
              ? arg.variableName(context, machineContext)
              : arg.variableName
          }
          selectionRanges={selection.selectionRanges}
          onChange={(change) => save(name, change.value)}
          onValidationChange={(next) =>
            setValidity((previous) => {
              const canSubmit = next.canSubmit && !next.isChecking
              return previous[name] === canSubmit
                ? previous
                : { ...previous, [name]: canSubmit }
            })
          }
        />
      )
    if (arg.inputType === 'selection')
      return (
        <div key={name} className="flex flex-col gap-1">
          <span className="capitalize">
            {label}
            {required && ' *'}
          </span>
          <button
            type="button"
            autoFocus={name === firstFieldName}
            aria-label={`Select ${label}`}
            aria-pressed={selection.activeName === name}
            disabled={Boolean(state.context.argumentsToSubmit.nodeToEdit)}
            title={
              state.context.argumentsToSubmit.nodeToEdit
                ? "Selection edits aren't supported yet."
                : undefined
            }
            className="m-0 rounded-sm border border-chalkboard-30 px-2 py-1 text-left text-xs focus-visible:ring-1 focus-visible:ring-primary aria-pressed:border-primary aria-pressed:text-primary dark:border-chalkboard-70"
            onClick={() => selection.select(name, arg)}
          >
            {isSelections(value) && hasValue(value)
              ? getSelectionTypeDisplayText(
                  kclManager.astSignal.value,
                  value,
                  kclManager.artifactGraph
                )
              : 'Select in the scene'}
          </button>
          {description}
        </div>
      )
    if (arg.inputType === 'options' || arg.inputType === 'boolean') {
      const choices =
        arg.inputType === 'boolean'
          ? [
              { name: 'On', value: true },
              { name: 'Off', value: false },
            ]
          : typeof arg.options === 'function'
            ? arg.options(context, machineContext)
            : arg.options
      const index = choices.findIndex((choice) => choice.value === value)
      return (
        <label key={name} className="flex flex-col gap-1">
          <span className="capitalize">
            {label}
            {required && ' *'}
          </span>
          <select
            autoFocus={name === firstFieldName}
            className="rounded-sm border border-chalkboard-30 bg-transparent px-2 py-1 text-xs dark:border-chalkboard-70"
            value={index < 0 ? '' : String(index)}
            onChange={(event) =>
              save(
                name,
                event.target.value === ''
                  ? undefined
                  : choices[Number(event.target.value)]?.value
              )
            }
          >
            <option value="" disabled={required}>
              {required ? 'Select an option' : 'Optional'}
            </option>
            {choices.map((choice, index) => (
              <option
                key={choice.name}
                value={index}
                disabled={'disabled' in choice && choice.disabled}
              >
                {choice.name}
              </option>
            ))}
          </select>
          {description}
        </label>
      )
    }
    return (
      <label key={name} className="flex flex-col gap-1">
        <span className="capitalize">
          {label}
          {required && ' *'}
        </span>
        <input
          type="text"
          autoFocus={name === firstFieldName}
          className="rounded-sm border border-chalkboard-30 bg-transparent px-2 py-1 text-xs dark:border-chalkboard-70"
          placeholder={
            !required && arg.inputType === 'tagDeclarator' ? 'None' : undefined
          }
          value={fieldText(value)}
          onChange={(event) => save(name, event.target.value)}
        />
        {description}
      </label>
    )
  }

  if (!command) return null
  const advanced = visible.filter(({ arg }) => arg.dialog?.advanced)
  return (
    <Draggable
      containerRef={containerRef}
      data-testid="modeling-dialog"
      role="region"
      aria-label={command.displayName || command.name}
      className="pointer-events-auto min-h-0 max-h-full w-80 max-w-full overflow-hidden rounded border border-chalkboard-30 bg-chalkboard-10 text-chalkboard-100 shadow-lg dark:border-chalkboard-70 dark:bg-chalkboard-100 dark:text-chalkboard-10"
      onContextMenu={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      Handle={
        <header className="flex shrink-0 cursor-move select-none items-center justify-between border-b border-chalkboard-30 px-3 py-2 dark:border-chalkboard-70">
          <span className="flex items-center gap-2 text-sm">
            {command.icon && (
              <CustomIcon name={command.icon} className="w-4 h-4" />
            )}
            {command.displayName || command.name}
          </span>
          <button
            type="button"
            onMouseDown={(event) => event.stopPropagation()}
            onClick={() => commands.send({ type: 'Close' })}
            className="m-0 border-0 bg-transparent p-0 text-xs"
          >
            Cancel
          </button>
        </header>
      }
    >
      <form
        onSubmit={(event) => {
          void submit(event)
        }}
        className="flex min-h-0 flex-col text-xs"
      >
        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto p-3">
          {initializing ? (
            <p>Loading arguments...</p>
          ) : (
            visible.filter(({ arg }) => !arg.dialog?.advanced).map(renderField)
          )}
          {!initializing && advanced.length > 0 && (
            <details>
              <summary className="cursor-pointer py-1">Advanced</summary>
              <div className="flex flex-col gap-3 pt-2">
                {advanced.map(renderField)}
              </div>
            </details>
          )}
        </div>
        <footer className="flex shrink-0 items-center justify-between gap-2 border-t border-chalkboard-30 p-3 dark:border-chalkboard-70">
          {codePreview.available && (
            <button
              type="button"
              aria-pressed={codePreview.open}
              className="m-0 shrink-0 rounded-sm border border-chalkboard-30 px-2 py-1 aria-pressed:border-primary aria-pressed:text-primary dark:border-chalkboard-70"
              onClick={codePreview.toggle}
            >
              Code changes
            </button>
          )}
          <span
            role={state.context.reviewValidationError ? 'alert' : undefined}
          >
            {state.context.reviewValidationError}
          </span>
          <button
            type="submit"
            disabled={initializing || submitting || checking || invalid}
            className="m-0 rounded-sm bg-primary px-3 py-1 text-white enabled:hover:bg-primary/90 disabled:opacity-50"
          >
            {checking || submitting ? 'Checking...' : 'Submit'}
          </button>
        </footer>
      </form>
    </Draggable>
  )
}
