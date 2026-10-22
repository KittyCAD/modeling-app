import { useSignals } from '@preact/signals-react/runtime'
import { Draggable } from '@kittycad/ui-components'
import type { RefObject } from 'react'
import { useEffect, useId, useRef, useState } from 'react'
import decamelize from 'decamelize'
import {
  CommandKclInput,
  getKclInputValue,
} from '@src/components/CommandBar/CommandKclInput'
import { CustomIcon } from '@src/components/CustomIcon'
import { MarkdownText } from '@src/components/MarkdownText'
import { DialogSelectionList } from '@src/components/ModelingDialog/DialogSelectionList'
import Tooltip from '@src/components/Tooltip'
import type { KclManager } from '@src/lang/KclManager'
import type { AppCommandSystem, AppSettingsSystem } from '@src/lib/app'
import { getSelectionTypeDisplayText, isSelections } from '@src/lib/selections'
import { isErr, trap } from '@src/lib/trap'
import { capitaliseFC } from '@src/lib/utils'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { Selections } from '@src/machines/modelingSharedTypes'
import type {
  CommandDialogSession,
  CommandScopeService,
} from '@src/registry/contracts/commands'
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
import { ArgumentHelp } from '@src/components/ModelingDialog/ArgumentHelp'
import { CommandHelp } from '@src/components/ModelingDialog/CommandHelp'

export default function ModelingDialog({
  containerRef,
  kclManager,
  commands,
  session,
  settings,
  wasmPromise,
  commandScopes,
  selectionRanges,
  modelingSend,
}: {
  containerRef: RefObject<HTMLElement | null>
  kclManager: KclManager
  commands: AppCommandSystem
  session: CommandDialogSession
  settings: AppSettingsSystem
  wasmPromise: Promise<ModuleType>
  commandScopes?: CommandScopeService
  selectionRanges: Selections
  modelingSend: EngineSceneViewExtensionProps['modelingSend']
}) {
  useSignals()
  const state = commands.useState()
  const fieldIdPrefix = useId()
  const { selectedCommand: command } = state.context
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [validity, setValidity] = useState<Record<string, boolean>>({})
  const [initializing, setInitializing] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const mounted = useRef(true)
  // Restore focus to the corresponding field after removing a selection.
  const selectionInputs = useRef(new Map<string, HTMLButtonElement>())
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
        if (!cancelled && commands.dialogSession.peek() === session) {
          setValues((previous) => ({ ...defaults, ...previous }))
          setInitializing(false)
        }
      })
      .catch((error: unknown) => {
        if (!cancelled && commands.dialogSession.peek() === session) {
          trap(error)
          setInitializing(false)
        }
      })
    return () => {
      cancelled = true
      mounted.current = false
    }
  }, [commands, session])

  const checking = state.matches('Checking Arguments for Dialog')
  const invalid = visible.some(({ name, arg, required }) => {
    if (arg.inputType === 'kcl') return validity[name] === false
    return required && !hasValue(context.argumentsToSubmit[name])
  })

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!command || initializing || submitting || checking || invalid) return
    const isCurrent = () =>
      mounted.current && commands.dialogSession.peek() === session
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
    const fieldId = `${fieldIdPrefix}-${name}`
    const label =
      arg.displayName || capitaliseFC(decamelize(name, { separator: ' ' }))
    const value = context.argumentsToSubmit[name]
    const description = arg.description && (
      <MarkdownText
        text={arg.description}
        className="parsed-markdown text-xs text-chalkboard-70 dark:text-chalkboard-40"
      />
    )
    const help = arg.documentation && (
      <ArgumentHelp label={label} text={arg.documentation} />
    )
    const fieldLabel = (
      <div className="flex items-center justify-between gap-1">
        <label htmlFor={fieldId} className="capitalize">
          {label}
          {required && ' *'}
        </label>
        {help}
      </div>
    )
    const machineContext = arg.machineActor?.getSnapshot().context
    switch (arg.inputType) {
      case 'kcl':
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
            labelAction={help}
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
      case 'selection':
        return (
          <div key={name} className="flex flex-col gap-1">
            {fieldLabel}
            <div
              role="group"
              aria-label={`${label} selections`}
              className={`rounded-sm border ${selection.activeName === name ? 'border-primary' : 'border-chalkboard-30 dark:border-chalkboard-70'}`}
            >
              <button
                id={fieldId}
                type="button"
                ref={(button) => {
                  if (button) selectionInputs.current.set(name, button)
                  else selectionInputs.current.delete(name)
                }}
                autoFocus={name === firstFieldName}
                aria-label={`Select ${label}`}
                aria-pressed={selection.activeName === name}
                disabled={Boolean(state.context.argumentsToSubmit.nodeToEdit)}
                title={
                  state.context.argumentsToSubmit.nodeToEdit
                    ? "Selection edits aren't supported yet."
                    : undefined
                }
                className="m-0 w-full rounded-sm border-0 bg-transparent px-2 py-1 text-left text-[10px] focus-visible:ring-1 focus-visible:ring-primary aria-pressed:text-primary"
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
              {isSelections(value) && hasValue(value) && (
                <div className="max-h-32 overflow-auto">
                  <DialogSelectionList
                    kclManager={kclManager}
                    wasmPromise={wasmPromise}
                    selectionRanges={value}
                    onChange={
                      state.context.argumentsToSubmit.nodeToEdit
                        ? undefined
                        : (next) => {
                            selection.update(name, next)
                            selectionInputs.current.get(name)?.focus()
                          }
                    }
                  />
                </div>
              )}
            </div>
            {description}
          </div>
        )
      case 'boolean':
      case 'options': {
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
          <div key={name} className="flex flex-col gap-1">
            {fieldLabel}
            <select
              id={fieldId}
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
          </div>
        )
      }
      case 'string':
      case 'number':
      case 'text':
      case 'vector3d':
      case 'path':
      case 'vector2d':
      case 'color':
      case 'tagDeclarator':
        return (
          <div key={name} className="flex flex-col gap-1">
            {fieldLabel}
            <input
              id={fieldId}
              type={arg.inputType === 'color' ? 'color' : 'text'}
              autoFocus={name === firstFieldName}
              className={`rounded-sm border border-chalkboard-30 bg-transparent px-2 py-1 text-xs dark:border-chalkboard-70 ${arg.inputType === 'color' ? 'h-8 w-full cursor-pointer' : ''}`}
              placeholder={
                !required && arg.inputType === 'tagDeclarator'
                  ? 'None'
                  : undefined
              }
              value={fieldText(value)}
              onChange={(event) => save(name, event.target.value)}
            />
            {description}
          </div>
        )
    }
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
          <div className="flex items-center gap-2">
            <CommandHelp command={command} />
            <button
              type="button"
              aria-label="Cancel"
              onMouseDown={(event) => event.stopPropagation()}
              onClick={() => commands.send({ type: 'Close' })}
              className="group m-0 rounded-sm p-0 border-none bg-transparent hover:bg-transparent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-appForeground"
            >
              <CustomIcon
                name="close"
                className="w-5 h-5 rounded-sm bg-destroy-10 text-destroy-80 dark:bg-destroy-80 dark:text-destroy-10 group-hover:brightness-110"
              />
              <Tooltip position="bottom-right">
                Cancel{' '}
                <kbd className="hotkey ml-4 dark:!bg-chalkboard-80">esc</kbd>
              </Tooltip>
            </button>
          </div>
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
