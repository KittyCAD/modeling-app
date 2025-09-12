import { useSelector } from '@xstate/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { StateFrom } from 'xstate'

import type { CommandArgument } from '@src/lib/commandTypes'
import {
  canSubmitSelectionArg,
  getSelectionCountByType,
  getSelectionTypeDisplayText,
  getSemanticSelectionType,
} from '@src/lib/selections'
import { engineCommandManager, kclManager } from '@src/lib/singletons'
import { commandBarActor, useCommandBarState } from '@src/lib/singletons'
import { reportRejection } from '@src/lib/trap'
import { toSync } from '@src/lib/utils'
import type { modelingMachine } from '@src/machines/modelingMachine'
import type { Selections } from '@src/machines/modelingSharedTypes'

const selectionSelector = (snapshot?: StateFrom<typeof modelingMachine>) =>
  snapshot?.context.selectionRanges

function CommandBarSelectionInput({
  arg,
  stepBack,
  onSubmit,
}: {
  arg: CommandArgument<unknown> & { inputType: 'selection'; name: string }
  stepBack: () => void
  onSubmit: (data: unknown) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const commandBarState = useCommandBarState()
  const [hasSubmitted, setHasSubmitted] = useState(false)
  const [hasClearedSelection, setHasClearedSelection] = useState(false)
  const selection = useSelector(arg.machineActor, selectionSelector)
  const selectionsByType = useMemo(() => {
    return getSelectionCountByType(selection)
  }, [selection])
  const isArgRequired =
    arg.required instanceof Function
      ? arg.required(commandBarState.context)
      : arg.required
  const canSubmitSelection = useMemo<boolean>(
    () => canSubmitSelectionArg(selectionsByType, arg),
    [selectionsByType, arg]
  )

  useEffect(() => {
    inputRef.current?.focus()
  }, [selection, inputRef])

  // Show the default planes if the selection type is 'plane'
  useEffect(() => {
    if (arg.selectionTypes.includes('plane') && !canSubmitSelection) {
      toSync(() => {
        return kclManager.showPlanes()
      }, reportRejection)()
    }

    return () => {
      toSync(() => {
        const promises = [
          new Promise(() => kclManager.setSelectionFilterToDefault(selection)),
        ]
        if (!kclManager._isAstEmpty(kclManager.ast)) {
          promises.push(kclManager.hidePlanes())
        }
        return Promise.all(promises)
      }, reportRejection)()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
  }, [])

  // Fast-forward through this arg if it's marked as skippable
  // and we have a valid selection already
  useEffect(() => {
    const argValue = commandBarState.context.argumentsToSubmit[arg.name]
    if (canSubmitSelection && arg.skip && argValue === undefined) {
      handleSubmit()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
  }, [arg.name, canSubmitSelection])

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

  // Clear selection if needed
  useEffect(() => {
    arg.clearSelectionFirst &&
      engineCommandManager.modelingSend({
        type: 'Set selection',
        data: {
          selectionType: 'singleCodeCursor',
        },
      }) &&
      setHasClearedSelection(true)
  }, [arg])

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

  // Set selection filter if needed, and reset it when the component unmounts
  useEffect(() => {
    arg.selectionFilter && kclManager.setSelectionFilter(arg.selectionFilter)
    return () => kclManager.setSelectionFilterToDefault(selection)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
  }, [arg.selectionFilter])

  return (
    <form id="arg-form" onSubmit={handleSubmit}>
      <label
        className={
          'relative flex flex-col mx-4 my-4 ' +
          (!hasSubmitted || canSubmitSelection || 'text-destroy-50')
        }
      >
        {canSubmitSelection
          ? getSelectionTypeDisplayText(selection) + ' selected'
          : `Please select ${
              arg.multiple ? 'one or more ' : 'one '
            }${getSemanticSelectionType(arg.selectionTypes).join(' or ')}`}
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

export default CommandBarSelectionInput
