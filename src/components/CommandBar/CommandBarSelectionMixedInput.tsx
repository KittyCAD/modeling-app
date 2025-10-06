import { useSelector } from '@xstate/react'
import { useEffect, useMemo, useRef, useState } from 'react'

import type { CommandArgument } from '@src/lib/commandTypes'
import {
  canSubmitSelectionArg,
  getSelectionCountByType,
  getSelectionTypeDisplayText,
} from '@src/lib/selections'
import { kclManager, engineCommandManager } from '@src/lib/singletons'
import { commandBarActor, useCommandBarState } from '@src/lib/singletons'
import type { Selections } from '@src/machines/modelingSharedTypes'

const selectionSelector = (snapshot: any) => snapshot?.context.selectionRanges

export default function CommandBarSelectionMixedInput({
  arg,
  stepBack,
  onSubmit,
}: {
  arg: CommandArgument<unknown> & { inputType: 'selectionMixed'; name: string }
  stepBack: () => void
  onSubmit: (data: unknown) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const commandBarState = useCommandBarState()
  const [hasSubmitted, setHasSubmitted] = useState(false)
  const [hasAutoSkipped, setHasAutoSkipped] = useState(false)
  const [hasClearedSelection, setHasClearedSelection] = useState(false)
  const selection: Selections = useSelector(arg.machineActor, selectionSelector)

  const selectionsByType = useMemo(() => {
    return getSelectionCountByType(selection)
  }, [selection])
  const isArgRequired =
    arg.required instanceof Function
      ? arg.required(commandBarState.context)
      : arg.required

  const canSubmitSelection = useMemo<boolean>(() => {
    // Don't do additional checks if this argument is not required
    if (!isArgRequired) return true
    if (!selection) return false
    const isNonZeroRange = selection.graphSelections.some((sel) => {
      const range = sel.codeRef.range
      return range[1] - range[0] !== 0 // Non-zero range is always valid
    })
    if (isNonZeroRange) return true
    return canSubmitSelectionArg(selectionsByType, arg)
  }, [selectionsByType, selection, arg, isArgRequired])

  useEffect(() => {
    inputRef.current?.focus()
  }, [selection, inputRef])

  // Clear selection in UI if needed
  useEffect(() => {
    if (arg.clearSelectionFirst) {
      engineCommandManager.modelingSend({
        type: 'Set selection',
        data: {
          selectionType: 'singleCodeCursor',
        },
      })
      setHasClearedSelection(true)
    }
  }, [arg.clearSelectionFirst])

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
  useEffect(() => {
    arg.selectionFilter && kclManager.setSelectionFilter(arg.selectionFilter)
    return () => kclManager.defaultSelectionFilter(selection)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
  }, [arg.selectionFilter])

  // Watch for outside teardowns of this component
  // (such as clicking another argument in the command palette header)
  // and quickly save the current selection if we can
  useEffect(() => {
    return () => {
      const resolvedSelection: Selections | undefined = isArgRequired
        ? selection
        : selection || {
            graphSelections: [],
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
      ? selection
      : selection || {
          graphSelections: [],
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
        (selection.graphSelections.length || selection.otherSelections.length)
          ? getSelectionTypeDisplayText(selection) + ' selected'
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
          onChange={handleChange}
          value={JSON.stringify(selection || {})}
        />
      </label>
    </form>
  )
}
