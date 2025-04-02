import { useSelector } from '@xstate/react'
import { useEffect, useMemo, useRef, useState } from 'react'

import type { CommandArgument } from '@src/lib/commandTypes'
import type { Selections } from '@src/lib/selections'
import {
  canSubmitSelectionArg,
  getSelectionCountByType,
} from '@src/lib/selections'
import { kclManager } from '@src/lib/singletons'
import { reportRejection } from '@src/lib/trap'
import { toSync } from '@src/lib/utils'
import {
  commandBarActor,
  useCommandBarState,
} from '@src/machines/commandBarMachine'

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
  const selection: Selections = useSelector(arg.machineActor, selectionSelector)

  const selectionsByType = useMemo(() => {
    return getSelectionCountByType(selection)
  }, [selection])

  const canSubmitSelection = useMemo<boolean>(() => {
    if (!selection) return false
    const isNonZeroRange = selection.graphSelections.some((sel) => {
      const range = sel.codeRef.range
      return range[1] - range[0] !== 0 // Non-zero range is always valid
    })
    if (isNonZeroRange) return true
    return canSubmitSelectionArg(selectionsByType, arg)
  }, [selectionsByType, selection])

  useEffect(() => {
    inputRef.current?.focus()
  }, [selection, inputRef])

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
  }, [])

  // Set selection filter if needed, and reset it when the component unmounts
  useEffect(() => {
    arg.selectionFilter && kclManager.setSelectionFilter(arg.selectionFilter)
    // TODO: We shouldn't use async here.
    return toSync(async () => {
      await kclManager.defaultSelectionFilter(selection)
    }, reportRejection)
  }, [arg.selectionFilter])

  function handleChange() {
    inputRef.current?.focus()
  }

  function handleSubmit(e?: React.FormEvent<HTMLFormElement>) {
    e?.preventDefault()

    if (!canSubmitSelection) {
      setHasSubmitted(true)
      return
    }

    onSubmit(selection)
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
        {canSubmitSelection
          ? 'Select objects in the scene'
          : 'Select code or objects in the scene'}

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
            if (event.key === 'Backspace' && event.shiftKey) {
              stepBack()
            } else if (event.key === 'Escape') {
              commandBarActor.send({ type: 'Close' })
            }
          }}
          onChange={handleChange}
          value={JSON.stringify(selection || {})}
        />
      </label>
    </form>
  )
}
