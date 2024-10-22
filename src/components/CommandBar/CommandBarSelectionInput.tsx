import { useSelector } from '@xstate/react'
import { useCommandsContext } from 'hooks/useCommandsContext'
import { useKclContext } from 'lang/KclProvider'
import { CommandArgument } from 'lib/commandTypes'
import {
  Selection,
  canSubmitSelectionArg,
  getSelectionType,
  getSelectionTypeDisplayText,
} from 'lib/selections'
import { modelingMachine } from 'machines/modelingMachine'
import { useEffect, useMemo, useRef, useState } from 'react'
import { StateFrom } from 'xstate'

const semanticEntityNames: { [key: string]: Array<Selection['type']> } = {
  face: ['extrude-wall', 'start-cap', 'end-cap'],
  edge: ['edge', 'line', 'arc'],
  point: ['point', 'line-end', 'line-mid'],
}

function getSemanticSelectionType(selectionType: Array<Selection['type']>) {
  const semanticSelectionType = new Set()
  selectionType.forEach((type) => {
    Object.entries(semanticEntityNames).forEach(([entity, entityTypes]) => {
      if (entityTypes.includes(type)) {
        semanticSelectionType.add(entity)
      }
    })
  })

  return Array.from(semanticSelectionType)
}

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
  const { code } = useKclContext()
  const inputRef = useRef<HTMLInputElement>(null)
  const { commandBarState, commandBarSend } = useCommandsContext()
  const [hasSubmitted, setHasSubmitted] = useState(false)
  const selection = useSelector(arg.machineActor, selectionSelector)
  const selectionsByType = useMemo(() => {
    const selectionRangeEnd = selection?.codeBasedSelections[0]?.range[1]
    return !selectionRangeEnd || selectionRangeEnd === code.length
      ? 'none'
      : getSelectionType(selection)
  }, [selection, code])
  const canSubmitSelection = useMemo<boolean>(
    () => canSubmitSelectionArg(selectionsByType, arg),
    [selectionsByType]
  )

  useEffect(() => {
    inputRef.current?.focus()
  }, [selection, inputRef])

  // Fast-forward through this arg if it's marked as skippable
  // and we have a valid selection already
  useEffect(() => {
    const argValue = commandBarState.context.argumentsToSubmit[arg.name]
    if (canSubmitSelection && arg.skip && argValue === undefined) {
      handleSubmit()
    }
  }, [canSubmitSelection])

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
        {arg.warningMessage && (
          <p className="text-warn-80 bg-warn-10 px-2 py-1 rounded-sm mt-3 mr-2 -mb-2 w-full text-sm cursor-default">
            {arg.warningMessage}
          </p>
        )}
        <input
          id="selection"
          name="selection"
          ref={inputRef}
          required
          placeholder="Select an entity with your mouse"
          className="absolute inset-0 w-full h-full opacity-0 cursor-default"
          onKeyDown={(event) => {
            if (event.key === 'Backspace') {
              stepBack()
            } else if (event.key === 'Escape') {
              commandBarSend({ type: 'Close' })
            }
          }}
          onChange={handleChange}
          value={JSON.stringify(selection || {})}
        />
      </label>
    </form>
  )
}

export default CommandBarSelectionInput
