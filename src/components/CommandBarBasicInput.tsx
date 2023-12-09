import { useCommandsContext } from 'hooks/useCommandsContext'
import { AllMachines } from 'hooks/useStateMachineCommands'
import { CommandArgument } from 'lib/createMachineCommand'
import { Dispatch, SetStateAction, useEffect, useRef } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'

function CommandBarBasicInput({
  arg,
  appendCommandArgumentData,
  stepBack,
}: {
  arg: CommandArgument<AllMachines> & { type: 'number' | 'string' }
  appendCommandArgumentData: Dispatch<SetStateAction<any>>
  stepBack: () => void
}) {
  const { setCommandBarOpen } = useCommandsContext()
  useHotkeys('mod + k, mod + /', () => setCommandBarOpen((prev) => !prev))
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [arg, inputRef])

  return (
    <form
      id="text-input-form"
      onSubmit={(event) => {
        event.preventDefault()
        event.stopPropagation()

        console.log('submitting??', event)

        appendCommandArgumentData({
          name:
            arg.type === 'number'
              ? parseFloat(inputRef.current?.value || '5')
              : inputRef.current?.value,
        })
      }}
    >
      <label className="flex items-center mx-4 my-4">
        <span className="px-2 py-1 rounded-l bg-chalkboard-100 dark:bg-chalkboard-80 text-chalkboard-10 border-b border-b-chalkboard-100 dark:border-b-chalkboard-80">
          {arg.name}
        </span>
        <input
          ref={inputRef}
          type={arg.type === 'number' ? 'number' : 'text'}
          className="flex-grow px-2 py-1 border-b border-b-chalkboard-100 dark:border-b-chalkboard-80 !bg-transparent focus:outline-none"
          placeholder="Enter a value"
          defaultValue={
            typeof arg.defaultValue === 'object'
              ? JSON.stringify(arg.defaultValue)
              : arg.defaultValue
          }
          onKeyDown={(event) => {
            if (event.key === 'Backspace' && !event.currentTarget.value) {
              stepBack()
            }
          }}
          autoFocus
        />
      </label>
    </form>
  )
}

export default CommandBarBasicInput
