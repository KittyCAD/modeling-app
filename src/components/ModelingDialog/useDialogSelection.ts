import { useEffect, useMemo, useRef, useState } from 'react'
import { useSelectionLifecycle } from '@src/hooks/useSelectionLifecycle'
import type { KclManager } from '@src/lang/KclManager'
import { coerceSelectionsForBodyOnlySelectionTypes } from '@src/lang/std/selectionCoercion'
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
  const selection = useMemo(
    () =>
      activeArg?.inputType === 'selection'
        ? (coerceSelectionsForBodyOnlySelectionTypes(
            selectionRanges,
            activeArg.selectionTypes,
            kclManager.artifactGraph
          ) ?? selectionRanges)
        : selectionRanges,
    [selectionRanges, activeArg, kclManager.artifactGraph]
  )

  useSelectionLifecycle({
    arg: activeArg,
    kclManager,
    wasmPromise,
    selection,
  })

  function select(name: string, arg: SelectionArgument) {
    if (activeName === name) return
    if (context.argumentsToSubmit.nodeToEdit) return
    if (activeName) save(activeName, structuredClone(selection))
    const saved = Object.hasOwn(values, name)
      ? values[name]
      : context.argumentsToSubmit[name]
    const next = isSelections(saved)
      ? saved
      : arg.clearSelectionFirst || activated.current
        ? emptySelection
        : selectionRanges
    modelingSend({
      type: 'Set selection',
      data: {
        selectionType: 'completeSelection',
        selection:
          coerceSelectionsForBodyOnlySelectionTypes(
            next,
            arg.selectionTypes,
            kclManager.artifactGraph
          ) ?? next,
      },
    })
    setActiveName(name)
    activated.current = true
  }

  function update(name: string, selection: Selections) {
    if (context.argumentsToSubmit.nodeToEdit) return
    save(name, selection)
    if (name === activeName) {
      modelingSend({
        type: 'Set selection',
        data: { selectionType: 'completeSelection', selection },
      })
    }
  }

  useEffect(() => {
    if (activated.current || context.argumentsToSubmit.nodeToEdit) return
    const field = fields.find((field) => field.arg.inputType === 'selection')
    if (field?.arg.inputType === 'selection') select(field.name, field.arg)
  })

  const draft = useMemo(
    () =>
      activeName
        ? {
            ...values,
            [activeName]: hasValue(selection) ? selection : undefined,
          }
        : values,
    [activeName, selection, values]
  )
  return { activeName, selectionRanges: selection, draft, select, update }
}
