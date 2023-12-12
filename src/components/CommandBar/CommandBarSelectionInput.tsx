import { useSelector } from '@xstate/react'
import { useCommandsContext } from 'hooks/useCommandsContext'
import { CommandArgument } from 'lib/commandTypes'
import { modelingMachine } from 'machines/modelingMachine'
import { useEffect, useRef } from 'react'
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
  const inputRef = useRef<HTMLInputElement>(null)
  const { commandBarSend } = useCommandsContext()
  const selection = useSelector(arg.actor, selectionSelector)

  useHotkeys('tab', () => onSubmit(selection), {
    enableOnFormTags: true,
    enableOnContentEditable: true,
    keyup: true,
  })

  useEffect(() => {
    inputRef.current?.focus()
  }, [selection, inputRef])

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    onSubmit(selection)
  }

  return (
    <form id="arg-form" onSubmit={handleSubmit}>
      <label className="relative flex items-center mx-4 my-4">
        {selection.codeBasedSelections.length >= 1
          ? `1 face selected: ${JSON.stringify(selection.codeBasedSelections)}`
          : 'Please select a face'}
        <input
          id="selection"
          name="selection"
          ref={inputRef}
          placeholder="Select an entity with your mouse"
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          onKeyDown={(event) => {
            if (event.key === 'Backspace') {
              stepBack()
            } else if (event.key === 'Escape') {
              commandBarSend({ type: 'Close' })
            }
          }}
          onChange={() => inputRef.current?.focus()}
          value={JSON.stringify(selection || {})}
        />
      </label>
    </form>
  )
}

export default CommandBarSelectionInput
