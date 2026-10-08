import { useEffect, useRef, useState } from 'react'
import { useModelingContext } from '@src/hooks/useModelingContext'
import { useApp, useSingletons } from '@src/lib/boot'
import { reportRejection } from '@src/lib/trap'
import type { CommandBarContext } from '@src/machines/commandBarMachine'
import type { Selections } from '@src/machines/modelingSharedTypes'
import {
  hasValue,
  isSelections,
  type DialogField,
  type SelectionArgument,
} from '@src/components/ModelingDialog/arguments'

const emptySelection: Selections = { graphSelections: [], otherSelections: [] }

/** Only the active field owns scene selection; other fields keep their captured values. */
export function useDialogSelection(
  context: CommandBarContext,
  fields: DialogField[],
  values: Record<string, unknown>,
  save: (name: string, value: unknown) => void
) {
  const { commands, wasmPromise } = useApp()
  const { kclManager } = useSingletons()
  const {
    context: { selectionRanges },
    send,
  } = useModelingContext()
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
    send({
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
