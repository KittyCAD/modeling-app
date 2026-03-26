import { useSelector } from '@xstate/react'
import { use, useEffect, useMemo, useRef, useState } from 'react'

import type { CommandArgument } from '@src/lib/commandTypes'
import {
  canSubmitSelectionArg,
  getSelectionCountByType,
  getSelectionTypeDisplayText,
  handleSelectionBatch,
} from '@src/lib/selections'
import { useApp } from '@src/lib/boot'
import { coerceSelectionsForBodyOnlySelectionTypes } from '@src/lang/std/selectionCoercion'
import type { Selections } from '@src/machines/modelingSharedTypes'
import {
  setSelectionFilter,
  setSelectionFilterToDefault,
} from '@src/lib/selectionFilterUtils'
import type { KclManager } from '@src/lang/KclManager'

const selectionSelector = (snapshot: any) => snapshot?.context.selectionRanges

export default function CommandBarSelectionMixedInput({
  arg,
  stepBack,
  onSubmit,
  executingEditor: kclManager,
}: {
  arg: CommandArgument<unknown> & { inputType: 'selectionMixed'; name: string }
  stepBack: () => void
  onSubmit: (data: unknown) => void
  executingEditor: KclManager
}) {
  const { commands, wasmPromise } = useApp()
  const wasmInstance = use(wasmPromise)
  const engineCommandManager = kclManager.engineCommandManager
  const sceneEntitiesManager = kclManager.sceneEntitiesManager
  const inputRef = useRef<HTMLInputElement>(null)
  const commandBarState = commands.useState()
  const [hasSubmitted, setHasSubmitted] = useState(false)
  const [hasAutoSkipped, setHasAutoSkipped] = useState(false)
  const [hasCoercedSelections, setHasCoercedSelections] = useState(false)
  const [hasClearedSelection, setHasClearedSelection] = useState(false)
  const selection: Selections = useSelector(arg.machineActor, selectionSelector)
  const effectiveSelection = useMemo(
    () =>
      coerceSelectionsForBodyOnlySelectionTypes(
        selection,
        arg.selectionTypes,
        kclManager.artifactGraph
      ) ?? selection,
    [selection, arg.selectionTypes, kclManager.artifactGraph]
  )

  const selectionsByType = useMemo(() => {
    return getSelectionCountByType(
      kclManager.ast,
      effectiveSelection,
      kclManager.artifactGraph
    )
  }, [effectiveSelection, kclManager.ast, kclManager.artifactGraph])

  useEffect(() => {
    setHasCoercedSelections(true)
  }, [])

  const isArgRequired =
    arg.required instanceof Function
      ? arg.required(commandBarState.context)
      : arg.required

  const canSubmitSelection = useMemo<boolean>(() => {
    // Don't do additional checks if this argument is not required
    if (!isArgRequired) return true
    if (!effectiveSelection) return false
    const isNonZeroRange = effectiveSelection.graphSelectionsV2.some((sel) => {
      const range = sel.codeRef?.range
      return range != null && range[1] - range[0] !== 0 // Non-zero range is always valid
    })
    if (isNonZeroRange) return true
    return canSubmitSelectionArg(selectionsByType, arg)
  }, [selectionsByType, effectiveSelection, arg, isArgRequired])

  useEffect(() => {
    inputRef.current?.focus()
  }, [effectiveSelection, inputRef])

  // Clear selection in UI if needed
  useEffect(() => {
    if (arg.clearSelectionFirst) {
      engineCommandManager.modelingSend({
        type: 'Set selection',
        data: {
          selectionType: 'singleCodeCursor',
          selection: {},
        },
      })
      setHasClearedSelection(true)
    }
  }, [arg.clearSelectionFirst, engineCommandManager])

  // Only auto-skip on initial mount if we have a valid selection
  // different from the component CommandBarSelectionInput in the the dependency array
  // is empty
  useEffect(() => {
    if (!hasAutoSkipped && canSubmitSelection && arg.skip) {
      const argValue = commandBarState.context.argumentsToSubmit[arg.name]
      if (argValue === undefined) {
        handleSubmit()
        setHasAutoSkipped(true)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
  }, [arg.name])

  // Set selection filter if needed, and reset it when the component unmounts
  // This runs after coercion completes and updates the selection
  useEffect(() => {
    if (arg.selectionFilter && hasCoercedSelections) {
      // Batch the filter change with selection restoration
      // This is critical for body-only commands where we've coerced face/edge selections to bodies
      setSelectionFilter({
        filter: arg.selectionFilter,
        engineCommandManager,
        kclManager,
        sceneEntitiesManager,
        selectionsToRestore: effectiveSelection,
        handleSelectionBatchFn: handleSelectionBatch,
        wasmInstance,
      })
    }
    return () => {
      if (arg.selectionFilter && hasCoercedSelections) {
        // Restore default filter with selections on cleanup
        setSelectionFilterToDefault({
          engineCommandManager,
          kclManager,
          sceneEntitiesManager,
          selectionsToRestore: effectiveSelection,
          handleSelectionBatchFn: handleSelectionBatch,
          wasmInstance,
        })
      }
    }
  }, [
    arg.selectionFilter,
    effectiveSelection,
    hasCoercedSelections,
    wasmInstance,
    engineCommandManager,
    kclManager,
    sceneEntitiesManager,
  ])

  // Watch for outside teardowns of this component
  // (such as clicking another argument in the command palette header)
  // and quickly save the current selection if we can
  useEffect(() => {
    return () => {
      const resolvedSelection: Selections | undefined = isArgRequired
        ? effectiveSelection
        : effectiveSelection || {
            graphSelectionsV2: [],
            otherSelections: [],
          }

      if (
        !(arg.clearSelectionFirst && !hasClearedSelection) &&
        canSubmitSelection &&
        resolvedSelection
      ) {
        onSubmit(resolvedSelection)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
  }, [hasClearedSelection])

  function handleChange() {
    inputRef.current?.focus()
  }

  function handleSubmit(e?: React.FormEvent<HTMLFormElement>) {
    e?.preventDefault()

    if (!canSubmitSelection) {
      setHasSubmitted(true)
      return
    }

    /**
     * Now that arguments like this can be optional, we need to
     * construct an empty selection if it's not required to get it past our validation.
     */
    const resolvedSelection: Selections | undefined = isArgRequired
      ? effectiveSelection
      : effectiveSelection || {
          graphSelectionsV2: [],
          otherSelections: [],
        }

    onSubmit(resolvedSelection)
  }

  const isMixedSelection = arg.inputType === 'selectionMixed'
  const allowNoSelection = isMixedSelection && arg.allowNoSelection
  const showSceneSelection =
    isMixedSelection && arg.selectionSource?.allowSceneSelection

  return (
    <form id="arg-form" onSubmit={handleSubmit}>
      <label
        className={
          'relative flex flex-col mx-4 my-4 ' +
          (!hasSubmitted || canSubmitSelection || 'text-destroy-50')
        }
      >
        {canSubmitSelection &&
        (effectiveSelection?.graphSelectionsV2.length ||
          effectiveSelection?.otherSelections.length ||
          effectiveSelection?.graphSelectionsV2.length)
          ? getSelectionTypeDisplayText(
              kclManager.astSignal.value,
              effectiveSelection,
              kclManager.artifactGraph
            ) + ' selected'
          : 'Select code/objects, or skip'}

        {showSceneSelection && (
          <div className="scene-selection mt-2">
            <p className="text-sm text-chalkboard-60">
              Select objects in the scene
            </p>
            {/* Scene selection UI will be handled by the parent component */}
          </div>
        )}

        {allowNoSelection && (
          <button
            type="button"
            onClick={() => onSubmit(null)}
            className="mt-2 px-4 py-2 rounded border border-chalkboard-30 text-chalkboard-90 dark:text-chalkboard-10 hover:bg-chalkboard-10 dark:hover:bg-chalkboard-90 transition-colors"
          >
            Continue without selection
          </button>
        )}
        <span data-testid="cmd-bar-arg-name" className="sr-only">
          {arg.name}
        </span>
        <input
          id="selection"
          name="selection"
          ref={inputRef}
          required
          data-testid="cmd-bar-arg-value"
          placeholder="Select an entity with your mouse"
          className="absolute inset-0 w-full h-full opacity-0 cursor-default"
          onKeyDown={(event) => {
            if (event.key === 'Backspace' && event.metaKey) {
              stepBack()
            } else if (event.key === 'Escape') {
              commands.send({ type: 'Close' })
            }
          }}
          onChange={handleChange}
          value={JSON.stringify(effectiveSelection || {})}
        />
      </label>
    </form>
  )
}
