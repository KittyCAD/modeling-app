import { useActor, useSelector } from '@xstate/react'
import { useCommandsContext } from 'hooks/useCommandsContext'
import { AllMachines } from 'hooks/useStateMachineCommands'
import { CommandArgument } from 'lib/commandTypes'
import { modelingMachine } from 'machines/modelingMachine'
import { Dispatch, SetStateAction, useRef } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { StateFrom } from 'xstate'

const selectionSelector = (snapshot: StateFrom<typeof modelingMachine>) =>
  snapshot.context.selectionRanges

function CommandBarSelectionInput({
  arg,
  appendCommandArgumentData,
  stepBack,
}: {
  arg: CommandArgument<AllMachines, unknown> & { type: 'selection' }
  appendCommandArgumentData: Dispatch<SetStateAction<any>>
  stepBack: () => void
}) {
  const buttonRef = useRef<HTMLButtonElement>(null)
  const { commandBarSend } = useCommandsContext()
  useHotkeys('esc', () => commandBarSend({ type: 'Close' }))
  useHotkeys('Backspace', () => stepBack())
  useHotkeys('enter', () => buttonRef.current?.click())
  const selection = useSelector(arg.actor, selectionSelector)

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.nativeEvent?.preventDefault()
    e.preventDefault()
    e.stopPropagation()

    console.log('submitting selection form', e)

    appendCommandArgumentData({ name: selection })
  }

  return (
    <form id="selection-input-form" onSubmit={handleSubmit}>
      <label className="flex items-center mx-4 my-4">
        Please select a face
        {selection.codeBasedSelections.length >= 1
          ? `: ${JSON.stringify(selection.codeBasedSelections)}`
          : ''}
        <input
          readOnly
          hidden
          placeholder="Enter a value"
          onKeyDown={(event) => {
            if (event.key === 'Backspace') {
              stepBack()
            }
          }}
          autoFocus
        />
      </label>
      <button ref={buttonRef} type="submit" hidden />
    </form>
  )
}

export default CommandBarSelectionInput
