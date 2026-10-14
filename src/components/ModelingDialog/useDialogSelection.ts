import { useEffect, useRef, useState } from 'react'
import type { KclManager } from '@src/lang/KclManager'
import type { AppCommandSystem } from '@src/lib/app'
import { reportRejection } from '@src/lib/trap'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { CommandBarContext } from '@src/machines/commandBarMachine'
import type { Selections } from '@src/machines/modelingSharedTypes'
import type { EngineSceneViewExtensionProps } from '@src/registry/contracts/engineScene'
import {
  hasValue,
  isSelections,
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
  commands,
  kclManager,
  wasmPromise,
  selectionRanges,
  modelingSend,
}: {
  context: CommandBarContext
  fields: DialogField[]
  values: Record<string, unknown>
  save: (name: string, value: unknown) => void
  commands: AppCommandSystem
  kclManager: KclManager
  wasmPromise: Promise<ModuleType>
  selectionRanges: Selections
  modelingSend: EngineSceneViewExtensionProps['modelingSend']
}) {
  const [activeName, setActiveName] = useState<string>()
  const activated = useRef(false)
  const selectionRef = useRef(selectionRanges)
  selectionRef.current = selectionRanges
  const activeArg = fields.find((field) => field.name === activeName)?.arg

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
    commands.send({
      type: 'Change current argument',
      data: { arg: { ...arg, name } },
    })
    modelingSend({
      type: 'Set selection',
      data: { selectionType: 'completeSelection', selection },
    })
    setActiveName(name)
    activated.current = true
  }

  useEffect(() => {
    if (activated.current || context.argumentsToSubmit.nodeToEdit) return
    const field = fields.find((field) => field.arg.inputType === 'selection')
    if (field?.arg.inputType === 'selection') select(field.name, field.arg)
  })

  useEffect(() => {
    if (!activeArg || activeArg.inputType !== 'selection') return
    const selectingPlane = activeArg.selectionTypes.includes('plane')
    if (selectingPlane) void kclManager.showPlanes().catch(reportRejection)
    let cancelled = false
    void wasmPromise
      .then((wasm) => {
        if (!cancelled && activeArg.selectionFilter)
          kclManager.setSelectionFilter(
            activeArg.selectionFilter,
            wasm,
            selectionRef.current
          )
      })
      .catch(reportRejection)
    return () => {
      cancelled = true
      if (selectingPlane && !kclManager._isAstEmpty(kclManager.ast))
        void kclManager.hidePlanes().catch(reportRejection)
      void wasmPromise
        .then((wasm) =>
          kclManager.setSelectionFilterToDefault(wasm, selectionRef.current)
        )
        .catch(reportRejection)
    }
  }, [activeArg, kclManager, wasmPromise])

  const draft = activeName
    ? {
        ...values,
        [activeName]: hasValue(selectionRanges) ? selectionRanges : undefined,
      }
    : values
  return { activeName, selectionRanges, draft, select }
}
