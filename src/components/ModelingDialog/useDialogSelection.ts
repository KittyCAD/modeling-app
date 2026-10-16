import { useEffect, useRef, useState } from 'react'
import { useSelectionLifecycle } from '@src/hooks/useSelectionLifecycle'
import type { KclManager } from '@src/lang/KclManager'
import { isSelections } from '@src/lib/selections'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { CommandBarContext } from '@src/machines/commandBarMachine'
import type { Selections } from '@src/machines/modelingSharedTypes'
import type { EngineSceneViewExtensionProps } from '@src/registry/contracts/engineScene'
import {
  hasValue,
  type DialogField,
  type SelectionArgument,
} from '@src/components/ModelingDialog/arguments'

const emptySelection: Selections = { graphSelections: [], otherSelections: [] }

/** Only the active field owns scene selection; other fields keep their captured values. */
export function useDialogSelection({
  context,
  fields,
  values,
  save,
  kclManager,
  wasmPromise,
  selectionRanges,
  modelingSend,
}: {
  context: CommandBarContext
  fields: DialogField[]
  values: Record<string, unknown>
  save: (name: string, value: unknown) => void
  kclManager: KclManager
  wasmPromise: Promise<ModuleType>
  selectionRanges: Selections
  modelingSend: EngineSceneViewExtensionProps['modelingSend']
}) {
  const [activeName, setActiveName] = useState<string>()
  const activated = useRef(false)
  const activeArg = fields.find((field) => field.name === activeName)?.arg

  useSelectionLifecycle({
    arg: activeArg,
    kclManager,
    wasmPromise,
    selection: selectionRanges,
  })

  function select(name: string, arg: SelectionArgument) {
    if (activeName === name) return
    if (context.argumentsToSubmit.nodeToEdit) return
    if (activeName) save(activeName, structuredClone(selectionRanges))
    const saved = Object.hasOwn(values, name)
      ? values[name]
      : context.argumentsToSubmit[name]
    const selection = isSelections(saved)
      ? saved
      : arg.clearSelectionFirst || activated.current
        ? emptySelection
        : selectionRanges
    modelingSend({
      type: 'Set selection',
      data: { selectionType: 'completeSelection', selection },
    })
    setActiveName(name)
    activated.current = true
  }

  function clear() {
    if (!activeName || context.argumentsToSubmit.nodeToEdit) return
    save(activeName, undefined)
    modelingSend({
      type: 'Set selection',
      data: {
        selectionType: 'completeSelection',
        selection: emptySelection,
      },
    })
  }

  useEffect(() => {
    if (activated.current || context.argumentsToSubmit.nodeToEdit) return
    const field = fields.find((field) => field.arg.inputType === 'selection')
    if (field?.arg.inputType === 'selection') select(field.name, field.arg)
  })

  const draft = activeName
    ? {
        ...values,
        [activeName]: hasValue(selectionRanges) ? selectionRanges : undefined,
      }
    : values
  return { activeName, selectionRanges, draft, select, clear }
}
