import {
  evaluateVisibility,
  getOptions,
  getDraftOrSubmittedValue,
  reconcileDialogArguments,
  type MachineContext,
  type ModelingDialogField,
} from '@src/components/ModelingDialog/ModelingDialog.arguments'
import {
  getActiveSelectionFieldName,
  isSelectionArgument,
  isBodyOnlySelectionArgument,
  isSelectionValueEmpty,
  selectionValueOrUndefined,
  cloneSelectionValue,
  removeSelectionItem,
  moveSelectionInSequence,
  EMPTY_SELECTION,
  type SelectionCommandArgument,
  type CapturedSelectionListItem,
} from '@src/components/ModelingDialog/ModelingDialog.logic'
import { useModelingContext } from '@src/hooks/useModelingContext'
import { useApp, useSingletons } from '@src/lib/boot'
import { coerceSelectionsToBody } from '@src/lang/std/artifactGraph'
import type { CommandArgument } from '@src/lib/commandTypes'
import { handleSelectionBatch } from '@src/lib/selections'
import { err } from '@src/lib/trap'
import type { CommandBarContext } from '@src/machines/commandBarMachine'
import type { Selections } from '@src/machines/modelingSharedTypes'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react'
import toast from 'react-hot-toast'

/** Own the scene selection collector for one mounted command invocation. */
export function useModelingDialogSelection({
  commandBarContext,
  selectedMachineContext,
  draftValues,
  setDraftValues,
  markArgumentDirty,
}: {
  commandBarContext: CommandBarContext
  selectedMachineContext?: MachineContext
  draftValues: Record<string, unknown>
  setDraftValues: Dispatch<SetStateAction<Record<string, unknown>>>
  markArgumentDirty: (argName: string) => void
}) {
  const { commands, wasmPromise } = useApp()
  const { kclManager } = useSingletons()
  const {
    context: { selectionRanges },
    send: modelingSend,
  } = useModelingContext()
  const selectedCommand = commandBarContext.selectedCommand
  const [activeSelectionArgName, setActiveSelectionArgName] = useState<
    string | null
  >(null)
  const [didAutoEnableSelection, setDidAutoEnableSelection] = useState(false)
  const selectionRangesRef = useRef(selectionRanges)
  const hasActivatedSelectionRef = useRef(false)
  useEffect(() => {
    selectionRangesRef.current = selectionRanges
  }, [selectionRanges])

  const coerceSelectionForArgument = useCallback(
    (
      arg: SelectionCommandArgument,
      selection: Selections | undefined
    ): Selections | undefined | Error => {
      if (!selection || !isBodyOnlySelectionArgument(arg)) {
        return selection
      }
      return coerceSelectionsToBody(selection, kclManager.artifactGraph)
    },
    [kclManager.artifactGraph]
  )

  const dialogArgumentsToSubmit = useMemo(() => {
    const nextValues = {
      ...commandBarContext.argumentsToSubmit,
      ...draftValues,
    }

    if (activeSelectionArgName && selectedCommand?.args) {
      const activeArg = selectedCommand.args[activeSelectionArgName]
      if (activeArg && isSelectionArgument(activeArg)) {
        nextValues[activeSelectionArgName] =
          selectionValueOrUndefined(selectionRanges)
      }
    }

    return reconcileDialogArguments(
      commandBarContext,
      nextValues,
      selectedMachineContext
    )
  }, [
    activeSelectionArgName,
    commandBarContext,
    draftValues,
    selectedMachineContext,
    selectedCommand?.args,
    selectionRanges,
  ])

  const dialogContext = useMemo<CommandBarContext>(
    () => ({
      ...commandBarContext,
      argumentsToSubmit: dialogArgumentsToSubmit,
    }),
    [commandBarContext, dialogArgumentsToSubmit]
  )

  const fields = useMemo<ModelingDialogField[]>(() => {
    if (!selectedCommand?.args) {
      return []
    }
    return Object.entries(selectedCommand.args).map(([argName, arg]) => {
      const { isHidden, isRequired, isDisabled } = evaluateVisibility(
        argName,
        arg,
        dialogContext,
        selectedMachineContext
      )
      return {
        argName,
        arg,
        isHidden,
        isRequired,
        isDisabled,
        options: getOptions(arg, dialogContext, selectedMachineContext),
      }
    })
  }, [selectedCommand?.args, dialogContext, selectedMachineContext])
  const activeSelectionFieldName = getActiveSelectionFieldName(
    fields,
    activeSelectionArgName
  )

  useEffect(() => {
    if (!activeSelectionArgName || !selectedCommand?.args) {
      return
    }
    const arg = selectedCommand.args[activeSelectionArgName]
    if (!arg || !isSelectionArgument(arg)) {
      return
    }

    let isCancelled = false
    const shouldShowPlanes = arg.selectionTypes.includes('plane')

    if (shouldShowPlanes) {
      kclManager.showPlanes().catch((error) => {
        console.error('Failed to show selection planes', error)
      })
    }

    void wasmPromise.then((wasmInstance) => {
      if (isCancelled) {
        return
      }
      if (arg.selectionFilter) {
        const selectionToRestore = coerceSelectionForArgument(
          arg,
          selectionValueOrUndefined(selectionRangesRef.current)
        )
        if (err(selectionToRestore)) {
          toast.error(selectionToRestore.message)
          return
        }
        kclManager.setSelectionFilter(
          arg.selectionFilter,
          wasmInstance,
          selectionToRestore,
          handleSelectionBatch
        )
      }
    })

    return () => {
      isCancelled = true
      // Hide before the next collector shows its planes; this does not need Wasm.
      if (shouldShowPlanes && !kclManager._isAstEmpty(kclManager.ast)) {
        kclManager.hidePlanes().catch((error) => {
          console.error('Failed to hide selection planes', error)
        })
      }
      void wasmPromise.then((wasmInstance) => {
        kclManager.setSelectionFilterToDefault(
          wasmInstance,
          selectionRangesRef.current,
          handleSelectionBatch
        )
      })
    }
  }, [
    activeSelectionArgName,
    coerceSelectionForArgument,
    kclManager,
    selectedCommand?.args,
    wasmPromise,
  ])

  const startSelectingArgument = useCallback(
    (argName: string, arg: CommandArgument<unknown>) => {
      if (
        activeSelectionArgName &&
        activeSelectionArgName !== argName &&
        selectedCommand?.args?.[activeSelectionArgName] &&
        isSelectionArgument(selectedCommand.args[activeSelectionArgName])
      ) {
        setDraftValues((prev) => ({
          ...prev,
          [activeSelectionArgName]: cloneSelectionValue(selectionRanges),
        }))
      }

      commands.send({
        type: 'Change current argument',
        data: {
          arg: {
            ...arg,
            name: argName,
          },
        },
      })
      setActiveSelectionArgName(argName)

      if (!isSelectionArgument(arg)) {
        return
      }
      const isInitialSelection = !hasActivatedSelectionRef.current
      hasActivatedSelectionRef.current = true
      markArgumentDirty(argName)

      const savedSelection = getDraftOrSubmittedValue(
        draftValues,
        commandBarContext.argumentsToSubmit,
        argName
      )
      if (!isSelectionValueEmpty(savedSelection)) {
        const selectionForArgument = coerceSelectionForArgument(
          arg,
          savedSelection as Selections
        )
        if (err(selectionForArgument)) {
          toast.error(selectionForArgument.message)
          return
        }
        modelingSend({
          type: 'Set selection',
          data: {
            selectionType: 'completeSelection',
            selection: structuredClone(selectionForArgument as Selections),
          },
        })
      } else if (arg.clearSelectionFirst || !isInitialSelection) {
        modelingSend({
          type: 'Set selection',
          data: {
            selectionType: 'completeSelection',
            selection: EMPTY_SELECTION,
          },
        })
      } else if (!isSelectionValueEmpty(selectionRanges)) {
        const selectionForArgument = coerceSelectionForArgument(
          arg,
          selectionRanges
        )
        if (err(selectionForArgument)) {
          toast.error(selectionForArgument.message)
          return
        }
        if (selectionForArgument) {
          modelingSend({
            type: 'Set selection',
            data: {
              selectionType: 'completeSelection',
              selection: selectionForArgument,
            },
          })
        }
      }
    },
    [
      activeSelectionArgName,
      commandBarContext.argumentsToSubmit,
      commands,
      coerceSelectionForArgument,
      draftValues,
      setDraftValues,
      markArgumentDirty,
      modelingSend,
      selectedCommand?.args,
      selectionRanges,
    ]
  )

  const removeSceneSelection = useCallback(
    (
      argName: string,
      source: CapturedSelectionListItem['source'],
      selectionIndex: number,
      selection: Selections | undefined = selectionRanges
    ) => {
      const arg = selectedCommand?.args?.[argName]
      if (!arg || !isSelectionArgument(arg)) {
        return
      }
      startSelectingArgument(argName, arg)

      const nextSelection = removeSelectionItem(
        selection,
        source,
        selectionIndex
      )

      const selectionForScene = nextSelection ?? EMPTY_SELECTION

      modelingSend({
        type: 'Set selection',
        data: {
          selectionType: 'completeSelection',
          selection: selectionForScene,
        },
      })
    },
    [
      modelingSend,
      selectedCommand?.args,
      selectionRanges,
      startSelectingArgument,
    ]
  )

  const moveSceneSelection = useCallback(
    (
      argName: string,
      source: CapturedSelectionListItem['source'],
      selectionIndex: number,
      direction: 'up' | 'down',
      selection: Selections | undefined = selectionRanges
    ) => {
      const arg = selectedCommand?.args?.[argName]
      if (!arg || !isSelectionArgument(arg)) {
        return
      }
      startSelectingArgument(argName, arg)

      const nextSelection = moveSelectionInSequence(
        selection,
        source,
        selectionIndex,
        direction
      )
      if (!nextSelection) {
        return
      }

      modelingSend({
        type: 'Set selection',
        data: {
          selectionType: 'completeSelection',
          selection: nextSelection,
        },
      })
    },
    [
      modelingSend,
      selectedCommand?.args,
      selectionRanges,
      startSelectingArgument,
    ]
  )

  const clearSceneSelection = useCallback(
    (argName: string) => {
      const arg = selectedCommand?.args?.[argName]
      if (!arg || !isSelectionArgument(arg)) {
        return
      }
      startSelectingArgument(argName, arg)

      modelingSend({
        type: 'Set selection',
        data: {
          selectionType: 'completeSelection',
          selection: EMPTY_SELECTION,
        },
      })
    },
    [modelingSend, selectedCommand?.args, startSelectingArgument]
  )

  useLayoutEffect(() => {
    if (!activeSelectionArgName || activeSelectionFieldName) {
      return
    }

    const activeField = fields.find(
      (field) => field.argName === activeSelectionArgName
    )
    if (activeField && isSelectionArgument(activeField.arg)) {
      setDraftValues((prev) => ({
        ...prev,
        [activeSelectionArgName]: cloneSelectionValue(selectionRanges),
      }))
    }
    setActiveSelectionArgName(null)
    setDidAutoEnableSelection(false)
  }, [
    activeSelectionArgName,
    activeSelectionFieldName,
    fields,
    selectionRanges,
    setDraftValues,
  ])

  useLayoutEffect(() => {
    if (didAutoEnableSelection || activeSelectionArgName !== null) {
      return
    }

    const hasAnySelectionArg = fields.some(({ arg }) =>
      isSelectionArgument(arg)
    )

    if (!hasAnySelectionArg) {
      setDidAutoEnableSelection(true)
      return
    }

    const firstVisibleSelectionField = fields.find(
      ({ isHidden, isDisabled, arg }) =>
        !isHidden && !isDisabled && isSelectionArgument(arg)
    )

    if (!firstVisibleSelectionField) {
      setDidAutoEnableSelection(true)
      return
    }

    startSelectingArgument(
      firstVisibleSelectionField.argName,
      firstVisibleSelectionField.arg
    )
    setDidAutoEnableSelection(true)
  }, [
    activeSelectionArgName,
    didAutoEnableSelection,
    fields,
    startSelectingArgument,
  ])

  return {
    selectionRanges,
    activeSelectionArgName,
    activeSelectionFieldName,
    dialogContext,
    fields,
    coerceSelectionForArgument,
    startSelectingArgument,
    removeSceneSelection,
    moveSceneSelection,
    clearSceneSelection,
  }
}
