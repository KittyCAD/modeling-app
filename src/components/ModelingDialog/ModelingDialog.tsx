import { CommandHelp } from '@src/components/ModelingDialog/CommandHelp'
import {
  ModelingDialogView,
  ModelingDialogFields,
} from '@src/components/ModelingDialog/ModelingDialogView'
import { ModelingArgumentFields } from '@src/components/ModelingDialog/ModelingArgumentFields'
import { useSignals } from '@preact/signals-react/runtime'
import type { RefObject } from 'react'
import { useEffect, useRef, useState } from 'react'
import { DialogSelectionList } from '@src/components/ModelingDialog/DialogSelectionList'
import type { KclManager } from '@src/lang/KclManager'
import type { AppCommandSystem, AppSettingsSystem } from '@src/lib/app'
import type { CommandInputValidationState } from '@src/lib/commandTypes'
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
  return (
    <ModelingDialogView
      containerRef={containerRef}
      command={command}
      commandHelp={<CommandHelp command={command} />}
      canSubmit={!initializing && !submitting && !checking && !invalid}
      checking={checking || submitting}
      error={state.context.reviewValidationError}
      onCancel={() => commands.send({ type: 'Close' })}
      onSubmit={(event) => {
        void submit(event)
      }}
    >
      <ModelingDialogFields
        fields={visible}
        initializing={initializing}
        renderFields={renderFields}
      />
    </ModelingDialogView>
  )
}
