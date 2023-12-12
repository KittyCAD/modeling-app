import { useCommandsContext } from 'hooks/useCommandsContext'
import { CommandArgument } from 'lib/commandTypes'
import { useEffect, useRef } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'

function CommandBarBasicInput({
  arg,
  stepBack,
  onSubmit,
}: {
  arg: CommandArgument<unknown> & {
    inputType: 'number' | 'string'
    name: string
  }
  stepBack: () => void
  onSubmit: (event: unknown) => void
}) {
  const { commandBarSend } = useCommandsContext()
  useHotkeys('mod + k, mod + /', () => commandBarSend({ type: 'Close' }))
  const inputRef = useRef<HTMLInputElement>(null)
  const inputType = arg.inputType === 'number' ? 'number' : 'text'

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [arg, inputRef])

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    onSubmit(inputRef.current?.value)
  }

  return (
    <form id="arg-form" onSubmit={handleSubmit}>
      <label className="flex items-center mx-4 my-4">
        <span className="capitalize px-2 py-1 rounded-l bg-chalkboard-100 dark:bg-chalkboard-80 text-chalkboard-10 border-b border-b-chalkboard-100 dark:border-b-chalkboard-80">
          {arg.name}
        </span>
        <input
          id="arg-form"
          name={inputType}
          ref={inputRef}
          type={inputType}
          className="flex-grow px-2 py-1 border-b border-b-chalkboard-100 dark:border-b-chalkboard-80 !bg-transparent focus:outline-none"
          placeholder="Enter a value"
          defaultValue={arg.defaultValue as string}
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
