import { useCommandsContext } from 'hooks/useCommandsContext'
import { CommandArgument } from 'lib/commandTypes'
import { useEffect, useRef } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'

function CommandBarBasicInput({
  arg,
  stepBack,
}: {
  arg: CommandArgument<unknown> & {
    inputType: 'number' | 'string'
    name: string
  }
  stepBack: () => void
}) {
  const { commandBarSend, commandBarState } = useCommandsContext()
  useHotkeys('mod + k, mod + /', () =>
    commandBarState.matches('Closed')
      ? commandBarSend({ type: 'Open' })
      : commandBarSend({ type: 'Close' })
  )
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

        commandBarSend({
          type: 'Submit argument',
          data: {
            [arg.name]:
              arg.inputType === 'number'
                ? parseFloat(inputRef.current?.value || '5')
                : inputRef.current?.value,
          },
        })
      }}
    >
      <label className="flex items-center mx-4 my-4">
        <span className="px-2 py-1 rounded-l bg-chalkboard-100 dark:bg-chalkboard-80 text-chalkboard-10 border-b border-b-chalkboard-100 dark:border-b-chalkboard-80">
          {arg.name}
        </span>
        <input
          ref={inputRef}
          type={arg.inputType === 'number' ? 'number' : 'text'}
          className="flex-grow px-2 py-1 border-b border-b-chalkboard-100 dark:border-b-chalkboard-80 !bg-transparent focus:outline-none"
          placeholder="Enter a value"
          defaultValue={
            (typeof arg.defaultValue !== 'object'
              ? arg.defaultValue || ''
              : JSON.stringify(arg.defaultValue || '{}')) as string
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
