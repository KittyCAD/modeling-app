import type { ReadonlySignal } from '@preact/signals-core'
import { isKclCommandValue } from '@src/lib/commandUtils'
import { useSignals } from '@preact/signals-react/runtime'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useApp } from '@src/lib/boot'
import { ModelingArgumentFields } from '@src/components/ModelingDialog/ModelingArgumentFields'
import { getDialogFields } from '@src/components/ModelingDialog/arguments'
import {
  parseArgumentDocument,
  setArgument,
} from '@src/lib/commandArguments/document'
import type { CommandArgumentsBinding } from '@src/lib/commandArguments/registry/contract'
import type { Editor } from '@src/lib/editors/registry/contract'
import type { Selections } from '@src/machines/modelingSharedTypes'
import { isSelections } from '@src/lib/selections'
import { commandScopeService } from '@src/registry/contracts/commands'

const empty: Selections = { graphSelections: [], otherSelections: [] }
/** The Form is another editor surface: every field change updates the canonical argument document. */
export default function CommandArgumentsForm({
  editor,
  binding,
  resolution,
}: {
  editor: Editor
  binding: CommandArgumentsBinding
  resolution?: ReadonlySignal<Record<string, unknown> | undefined>
}) {
  useSignals()
  const { settings, wasmPromise, registry } = useApp()
  const parsed = parseArgumentDocument(editor.contents.value)
  const [activeName, setActiveName] = useState<string>()
  const [selectionError, setSelectionError] = useState<string>()
  const values = parsed instanceof Error ? {} : parsed
  const context = { ...binding.context, argumentsToSubmit: values }
  const model = binding.getModel(values)
  const fields = getDialogFields(context)
  const active = fields.find((field) => field.name === activeName)?.arg
  const save = useCallback(
    (name: string, value: unknown) =>
      setArgument(
        editor,
        name,
        isKclCommandValue(value) && !('variableName' in value)
          ? value.valueText
          : value === ''
            ? undefined
            : value
      ),
    [editor]
  )
  const invalidDocument = parsed instanceof Error
  const latest = useRef(values)
  latest.current = values
  useEffect(() => {
    if (
      invalidDocument ||
      !model ||
      !activeName ||
      active?.inputType !== 'selection'
    )
      return
    return model.collect(
      active,
      (selection, add) => {
        const previous = latest.current[activeName]
        save(
          activeName,
          add && isSelections(previous)
            ? {
                graphSelections: [
                  ...previous.graphSelections,
                  ...selection.graphSelections,
                ],
                otherSelections: [
                  ...previous.otherSelections,
                  ...selection.otherSelections,
                ],
              }
            : selection
        )
        setSelectionError(undefined)
      },
      setSelectionError
    )
  }, [model, active, activeName, save, invalidDocument])
  if (parsed instanceof Error)
    return (
      <p role="alert" className="p-3 text-sm">
        {parsed.message}
      </p>
    )
  const selection = {
    activeName,
    selectionRanges:
      activeName && isSelections(values[activeName])
        ? values[activeName]
        : empty,
    select: (name: string) => setActiveName(name),
    update: (name: string, value: Selections) => {
      save(name, value)
    },
  }
  const renderFields = (advanced: boolean) => (
    <ModelingArgumentFields
      fields={fields.filter(
        (field) => Boolean(field.arg.dialog?.advanced) === advanced
      )}
      context={context}
      submittedValues={resolution?.value ?? binding.context.argumentsToSubmit}
      model={model}
      artifactGraph={model?.artifactGraph}
      settings={settings}
      wasmPromise={wasmPromise}
      commandScopes={registry.optional(commandScopeService)}
      selection={selection}
      save={save}
      updateValidation={() => {}}
      firstFieldName={fields.find((field) => !field.arg.dialog?.advanced)?.name}
      renderSelectionList={(value, onChange) => (
        <ul className="px-2 pb-1">
          {[...value.graphSelections, ...value.otherSelections].map(
            (_, index) => (
              <li
                key={index}
                className="flex items-center justify-between gap-2"
              >
                <span>Selection {index + 1}</span>
                <button
                  type="button"
                  aria-label={`Remove selection ${index + 1}`}
                  onClick={() =>
                    onChange?.({
                      graphSelections: value.graphSelections.filter(
                        (_, i) => i !== index
                      ),
                      otherSelections: value.otherSelections.filter(
                        (_, i) => i + value.graphSelections.length !== index
                      ),
                    })
                  }
                >
                  ×
                </button>
              </li>
            )
          )}
        </ul>
      )}
    />
  )
  return (
    <div className="flex flex-col gap-3 p-3 text-xs">
      {renderFields(false)}
      {fields.some((field) => field.arg.dialog?.advanced) && (
        <details>
          <summary>Advanced</summary>
          <div className="flex flex-col gap-3 pt-2">{renderFields(true)}</div>
        </details>
      )}
      {selectionError && <p role="alert">{selectionError}</p>}
    </div>
  )
}
