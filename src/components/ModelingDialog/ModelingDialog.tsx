import { ModelingArgumentFields } from '@src/components/ModelingDialog/ModelingArgumentFields'
import { useSignals } from '@preact/signals-react/runtime'
import { Draggable } from '@kittycad/ui-components'
import type { RefObject } from 'react'
import { useEffect, useRef, useState } from 'react'
import { CustomIcon } from '@src/components/CustomIcon'
import { ErrorBanner } from '@src/components/ErrorBanner'
import { DialogSelectionList } from '@src/components/ModelingDialog/DialogSelectionList'
import Tooltip from '@src/components/Tooltip'
import type { KclManager } from '@src/lang/KclManager'
import type { AppCommandSystem, AppSettingsSystem } from '@src/lib/app'
import type { CommandInputValidationState } from '@src/lib/commandTypes'
import { noAutofillFormProps } from '@src/lib/autofill'
import { isErr, trap } from '@src/lib/trap'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { Selections } from '@src/machines/modelingSharedTypes'
import type { CommandScopeService } from '@src/registry/contracts/commands'
import type { EngineSceneViewExtensionProps } from '@src/registry/contracts/engineScene'
import {
  type DialogField,
  getDialogFields,
  hasValue,
  initializeArguments,
  resolveArguments,
} from '@src/components/ModelingDialog/arguments'
import { useDialogSelection } from '@src/components/ModelingDialog/useDialogSelection'
import { CommandHelp } from '@src/components/ModelingDialog/CommandHelp'

export default function ModelingDialog({
  containerRef,
  kclManager,
  commands,
  settings,
  wasmPromise,
  commandScopes,
  selectionRanges,
  modelingSend,
}: {
  containerRef: RefObject<HTMLElement | null>
  kclManager: KclManager
  commands: AppCommandSystem
  settings: AppSettingsSystem
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
  const updateValidation = (name: string, next: CommandInputValidationState) =>
    setValidity((previous) => {
      const canSubmit = next.canSubmit && !next.isChecking
      return previous[name] === canSubmit
        ? previous
        : { ...previous, [name]: canSubmit }
    })
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
  useEffect(() => {
    commands.actor.send({ type: 'Dialog draft changed' })
  }, [commands.actor, selection.draft])
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
    switch (arg.inputType) {
      case 'kcl':
      case 'vector2d':
      case 'vector3d':
        return validity[name] === false
      case 'camera':
        return (
          validity[name] === false ||
          (required && !hasValue(context.argumentsToSubmit[name]))
        )
      case 'selection':
      case 'boolean':
      case 'options':
      case 'color':
      case 'tagDeclarator':
      case 'string':
      case 'number':
      case 'text':
      case 'path':
        return required && !hasValue(context.argumentsToSubmit[name])
    }
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

  const renderFields = (fields: DialogField[]) => (
    <ModelingArgumentFields
      fields={fields}
      context={context}
      submittedValues={state.context.argumentsToSubmit}
      model={kclManager}
      artifactGraph={kclManager.artifactGraph}
      settings={settings}
      wasmPromise={wasmPromise}
      commandScopes={commandScopes}
      selection={selection}
      save={save}
      updateValidation={updateValidation}
      firstFieldName={firstFieldName}
      cameraControls={kclManager.sceneInfra.camControls}
      renderSelectionList={(value, onChange) => (
        <DialogSelectionList
          kclManager={kclManager}
          wasmPromise={wasmPromise}
          selectionRanges={value}
          onChange={onChange}
        />
      )}
    />
  )
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
        {...noAutofillFormProps}
        onSubmit={(event) => {
          void submit(event)
        }}
        className="flex min-h-0 flex-col text-xs"
      >
        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto p-3">
          {initializing ? (
            <p>Loading arguments...</p>
          ) : (
            renderFields(visible.filter(({ arg }) => !arg.dialog?.advanced))
          )}
          {!initializing && advanced.length > 0 && (
            <details>
              <summary className="cursor-pointer py-1">Advanced</summary>
              <div className="flex flex-col gap-3 pt-2">
                {renderFields(advanced)}
              </div>
            </details>
          )}
        </div>
        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-chalkboard-30 p-3 dark:border-chalkboard-70">
          {state.context.reviewValidationError && (
            <div className="w-full">
              <ErrorBanner
                title="Check these arguments"
                message={state.context.reviewValidationError}
              />
            </div>
          )}
          <button
            type="submit"
            disabled={initializing || submitting || checking || invalid}
            className="m-0 ml-auto rounded-sm bg-primary px-3 py-1 text-white enabled:hover:bg-primary/90 disabled:opacity-50"
          >
            {checking || submitting ? 'Checking...' : 'Submit'}
          </button>
        </footer>
      </form>
    </Draggable>
  )
}
