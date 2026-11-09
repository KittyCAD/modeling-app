import { useId, useRef, type ReactNode, type ComponentProps } from 'react'
import decamelize from 'decamelize'
import {
  CommandKclInput,
  getKclInputValue,
  type CommandKclArgument,
  type CommandKclModel,
} from '@src/components/CommandBar/CommandKclInput'
import { CommandCameraInput } from '@src/components/CommandBar/CommandCameraInput'
import { MarkdownText } from '@src/components/MarkdownText'
import { ArgumentHelp } from '@src/components/ModelingDialog/ArgumentHelp'
import {
  fieldText,
  hasValue,
  type DialogField,
  type SelectionArgument,
} from '@src/components/ModelingDialog/arguments'
import { noAutofillInputProps } from '@src/lib/autofill'
import { getSelectionTypeDisplayText, isSelections } from '@src/lib/selections'
import { capitaliseFC, isRecord } from '@src/lib/utils'
import type { AppSettingsSystem } from '@src/lib/app'
import type { CommandInputValidationState } from '@src/lib/commandTypes'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { CommandBarContext } from '@src/machines/commandBarMachine'
import type { Selections } from '@src/machines/modelingSharedTypes'
import type { ArtifactGraph } from '@src/lang/wasm'
import type { CommandScopeService } from '@src/registry/contracts/commands'

/** The stdlib form controls are shared by the legacy dialog and document-backed editor modes. */
export function ModelingArgumentFields({
  fields,
  context,
  submittedValues,
  model,
  artifactGraph,
  settings,
  wasmPromise,
  commandScopes,
  selection,
  save,
  updateValidation,
  firstFieldName,
  cameraControls,
  renderSelectionList,
}: {
  fields: DialogField[]
  context: CommandBarContext
  submittedValues: Record<string, unknown>
  model?: CommandKclModel
  artifactGraph?: ArtifactGraph
  settings: AppSettingsSystem
  wasmPromise: Promise<ModuleType>
  commandScopes?: CommandScopeService
  selection: {
    activeName?: string
    selectionRanges: Selections
    select: (name: string, arg: SelectionArgument) => void
    update: (name: string, value: Selections) => void
  }
  save: (name: string, value: unknown) => void
  updateValidation: (name: string, state: CommandInputValidationState) => void
  firstFieldName?: string
  cameraControls?: ComponentProps<typeof CommandCameraInput>['controls']
  renderSelectionList?: (
    value: Selections,
    onChange?: (value: Selections) => void
  ) => ReactNode
}) {
  const fieldIdPrefix = useId()
  const selectionInputs = useRef(new Map<string, HTMLButtonElement>())
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
      case 'camera':
        if (!cameraControls)
          return <p key={name}>Camera capture is unavailable in this view.</p>
        return (
          <div key={name} className="flex flex-col gap-1">
            {fieldLabel}
            <CommandCameraInput
              id={fieldId}
              controls={cameraControls}
              saved={hasValue(value)}
              captured={isRecord(value) && 'look' in value}
              onChange={(camera) => save(name, camera)}
              onValidationChange={(next) => updateValidation(name, next)}
            />
            {description}
          </div>
        )
      case 'kcl':
        if (!model)
          return (
            <label key={name} className="flex flex-col gap-1">
              {label}
              <input
                value={fieldText(value)}
                onChange={(event) => save(name, event.target.value)}
                className="rounded border border-3 bg-transparent px-2 py-1"
              />
            </label>
          )
        return (
          <CommandKclInput
            key={name}
            kclManager={model}
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
            submittedValue={submittedValues[name]}
            nodeToEdit={submittedValues.nodeToEdit}
            variableName={
              typeof arg.variableName === 'function'
                ? arg.variableName(context, machineContext)
                : arg.variableName
            }
            selectionRanges={selection.selectionRanges}
            onChange={(change) => save(name, change.value)}
            onValidationChange={(next) => updateValidation(name, next)}
          />
        )
      case 'vector2d':
      case 'vector3d': {
        if (!model)
          return (
            <label key={name}>
              {label}
              <input
                value={fieldText(value)}
                onChange={(event) => save(name, event.target.value)}
              />
            </label>
          )
        const vectorArg: CommandKclArgument = {
          ...arg,
          inputType: 'kcl',
          allowArrays: true,
          createVariable: 'disallow',
        }
        return (
          <CommandKclInput
            key={name}
            kclManager={model}
            settings={settings}
            wasmPromise={wasmPromise}
            commandScopes={commandScopes}
            name={name}
            arg={vectorArg}
            label={label}
            labelAction={help}
            description={description}
            placeholder={required ? undefined : 'Use defaults'}
            isRequired={required}
            inline={false}
            autoFocus={name === firstFieldName}
            value={getKclInputValue(vectorArg, value)}
            submittedValue={submittedValues[name]}
            nodeToEdit={submittedValues.nodeToEdit}
            selectionRanges={selection.selectionRanges}
            onChange={(change) => save(name, change.value)}
            onValidationChange={(next) => updateValidation(name, next)}
          />
        )
      }
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
                data-modeling-dialog-selection={selection.activeName === name}
                disabled={Boolean(submittedValues.nodeToEdit)}
                title={
                  submittedValues.nodeToEdit
                    ? "Selection edits aren't supported yet."
                    : undefined
                }
                className="m-0 w-full rounded-sm border-0 bg-transparent px-2 py-1 text-left text-[10px] focus-visible:ring-1 focus-visible:ring-primary aria-pressed:text-primary"
                onClick={() => selection.select(name, arg)}
              >
                {isSelections(value) && hasValue(value)
                  ? model
                    ? getSelectionTypeDisplayText(
                        model.astSignal.value,
                        value,
                        artifactGraph
                      )
                    : 'Selected geometry'
                  : 'Select in the scene'}
              </button>
              {isSelections(value) && hasValue(value) && (
                <div className="max-h-32 overflow-auto">
                  {renderSelectionList?.(
                    value,
                    submittedValues.nodeToEdit
                      ? undefined
                      : (next) => {
                          selection.update(name, next)
                          selectionInputs.current.get(name)?.focus()
                        }
                  )}
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
      case 'color':
        return (
          <div key={name} className="flex flex-col gap-1">
            {fieldLabel}
            <input
              {...noAutofillInputProps}
              id={fieldId}
              type="color"
              autoFocus={name === firstFieldName}
              className="h-8 w-full cursor-pointer rounded-sm border border-chalkboard-30 bg-transparent px-2 py-1 text-xs dark:border-chalkboard-70"
              value={fieldText(value)}
              onChange={(event) => save(name, event.target.value)}
            />
            {description}
          </div>
        )
      case 'tagDeclarator':
        return (
          <div key={name} className="flex flex-col gap-1">
            {fieldLabel}
            <div className="relative">
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-px left-px flex items-center pl-2 text-xs"
              >
                $
              </span>
              <input
                {...noAutofillInputProps}
                id={fieldId}
                type="text"
                autoFocus={name === firstFieldName}
                className="w-full rounded-sm border border-chalkboard-30 bg-transparent py-1 pl-4 pr-2 text-xs dark:border-chalkboard-70"
                placeholder={required ? undefined : 'None'}
                value={fieldText(value)}
                onChange={(event) =>
                  save(name, event.target.value.replace(/^\$/, ''))
                }
              />
            </div>
            {description}
          </div>
        )
      case 'string':
      case 'number':
      case 'text':
      case 'path': {
        const Input = arg.inputType === 'text' ? 'textarea' : 'input'
        return (
          <div key={name} className="flex flex-col gap-1">
            {fieldLabel}
            <Input
              {...noAutofillInputProps}
              id={fieldId}
              rows={arg.inputType === 'text' ? 3 : undefined}
              autoFocus={name === firstFieldName}
              className="rounded-sm border border-chalkboard-30 bg-transparent px-2 py-1 text-xs dark:border-chalkboard-70"
              value={fieldText(value)}
              onChange={(event) => save(name, event.target.value)}
            />
            {description}
          </div>
        )
      }
    }
  }

  return <>{fields.map(renderField)}</>
}
