import { useSelector } from '@xstate/react'
import { useCommandsContext } from 'hooks/useCommandsContext'
import { useKclContext } from 'lang/KclProvider'
import { CommandArgument } from 'lib/commandTypes'
import {
  canSubmitSelectionArg,
  getSelectionType,
  getSelectionTypeDisplayText,
} from 'lib/selections'
import { modelingMachine } from 'machines/modelingMachine'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { StateFrom } from 'xstate'

const selectionSelector = (snapshot: StateFrom<typeof modelingMachine>) =>
  snapshot.context.selectionRanges

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
  const initSelectionsByType = useCallback(() => {
    const selectionRangeEnd = selection.codeBasedSelections[0]?.range[1]
    return !selectionRangeEnd || selectionRangeEnd === code.length
      ? 'none'
      : getSelectionType(selection)
  }, [selection, code])
  const selectionsByType = initSelectionsByType()
  const [canSubmitSelection, setCanSubmitSelection] = useState<boolean>(
    canSubmitSelectionArg(selectionsByType, arg)
  )

  useHotkeys('tab', () => onSubmit(selection), {
    enableOnFormTags: true,
    enableOnContentEditable: true,
    keyup: true,
  })

  useEffect(() => {
    inputRef.current?.focus()
  }, [selection, inputRef])

  // Fast-forward through this arg if it's marked as skippable
  // and we have a valid selection already
  useEffect(() => {
    console.log('selection input effect', {
      selectionsByType,
      canSubmitSelection,
      arg,
    })
    setCanSubmitSelection(canSubmitSelectionArg(selectionsByType, arg))
    const argValue = commandBarState.context.argumentsToSubmit[arg.name]
    if (canSubmitSelection && arg.skip && argValue === undefined) {
      handleSubmit({
        preventDefault: () => {},
      } as React.FormEvent<HTMLFormElement>)
    }
  }, [selectionsByType, arg])

  function handleChange() {
    inputRef.current?.focus()
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()

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
          'relative flex items-center mx-4 my-4 ' +
          (!hasSubmitted || canSubmitSelection || 'text-destroy-50')
        }
      >
        {canSubmitSelection
          ? getSelectionTypeDisplayText(selection) + ' selected'
          : `Please select ${arg.multiple ? 'one or more faces' : 'one face'}`}
        <input
          id="selection"
          name="selection"
          ref={inputRef}
          required
          placeholder="Select an entity with your mouse"
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
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
