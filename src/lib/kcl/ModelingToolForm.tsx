import { DialogSelectionList } from '@src/components/ModelingDialog/DialogSelectionList'
import { ModelingDialogFields } from '@src/components/ModelingDialog/ModelingDialogView'
import type { DialogField } from '@src/components/ModelingDialog/arguments'
import { useState } from 'react'
import type { CommandKclModel } from '@src/components/CommandBar/CommandKclInput'
import type { KclCommandValue } from '@src/lib/commandTypes'
import { getKclInputValue } from '@src/components/CommandBar/CommandKclInput'
import { isKclCommandValue } from '@src/lib/commandUtils'
import { useSignals } from '@preact/signals-react/runtime'
import { ModelingArgumentFields } from '@src/components/ModelingDialog/ModelingArgumentFields'
import { getDialogFields } from '@src/components/ModelingDialog/arguments'
import type { ModelingToolDialog } from '@src/lib/kcl/modelingDialog'
import type { ModelingViewContext } from '@src/lib/kcl/registry/contract'
import { isErr } from '@src/lib/trap'
import { isSelections } from '@src/lib/selections'
import type { Selections } from '@src/machines/modelingSharedTypes'
const emptySelection: Selections = { graphSelections: [], otherSelections: [] }

export default function ModelingToolForm({
  dialog,
  context,
}: {
  dialog: ModelingToolDialog
  context: ModelingViewContext
}) {
  useSignals()
  const [calculated, setCalculated] = useState<
    Record<
      string,
      { input: string; result: KclCommandValue; model: CommandKclModel }
    >
  >({})
  const model = dialog.model.value
  const values = dialog.values.value
  if (isErr(values)) return null
  const argumentValues = { ...values }
  for (const [name, cached] of Object.entries(calculated)) {
    if (cached.model === model && cached.input === JSON.stringify(values[name]))
      argumentValues[name] = cached.result
  }
  const draftContext = {
    selectedCommand: dialog.command,
    argumentsToSubmit: argumentValues,
  }
  const fields = getDialogFields(draftContext)
  const selectedName = dialog.activeName.value
  const selected = selectedName && values[selectedName]
  const renderFields = (fields: DialogField[]) => (
    <ModelingArgumentFields
      uniqueInputIds
      fields={fields}
      firstFieldName={fields.find((field) => !field.arg.dialog?.advanced)?.name}
      context={draftContext}
      submittedValues={values}
      model={model}
      artifactGraph={
        context.session.resource.value?.runtime.state.value.artifactGraph
      }
      settings={context.settings}
      wasmPromise={context.wasm}
      selection={{
        activeName: selectedName,
        selectionRanges: isSelections(selected) ? selected : emptySelection,
        select: (name) => {
          dialog.activate(name)
        },
        focus: (name) => {
          dialog.activate(name)
        },
        update: (name, value) => {
          dialog.updateSelection(name, value)
        },
      }}
      save={(name, value, source) => {
        if (source === 'calculation') {
          const current = dialog.values.peek()
          if (isErr(current)) return
          const arg = dialog.command.args?.[name]
          if (arg?.inputType !== 'kcl') return
          if (
            arg?.inputType === 'kcl' &&
            getKclInputValue(arg, current[name]) !==
              getKclInputValue(arg, value)
          )
            return
          if (isKclCommandValue(value) && model) {
            const input = JSON.stringify(current[name])
            setCalculated((previous) => {
              const cached = previous[name]
              return cached?.model === model &&
                cached.input === input &&
                JSON.stringify(cached.result) === JSON.stringify(value)
                ? previous
                : { ...previous, [name]: { input, result: value, model } }
            })
          }
          if (!isKclCommandValue(value) || !('variableName' in value)) return
        }
        dialog.save(name, value)
      }}
      updateValidation={() => {}}
      renderSelectionList={(value, onChange) => (
        <DialogSelectionList
          kclManager={dialog.referenceModel.value}
          wasmPromise={context.wasm}
          selectionRanges={value}
          onChange={onChange}
        />
      )}
    />
  )
  return <ModelingDialogFields fields={fields} renderFields={renderFields} />
}
