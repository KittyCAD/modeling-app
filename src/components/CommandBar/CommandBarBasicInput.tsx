import { CommandArgument } from 'lib/commandTypes'
import { commandBarActor, useCommandBarState } from 'machines/commandBarMachine'
import { useEffect, useRef } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'

function CommandBarBasicInput({
  arg,
  stepBack,
  onSubmit,
}: {
  arg: CommandArgument<unknown> & {
    inputType: 'string'
    name: string
  }
  stepBack: () => void
  onSubmit: (event: unknown) => void
}) {
  const commandBarState = useCommandBarState()
  useHotkeys('mod + k, mod + /', () => commandBarActor.send({ type: 'Close' }))
  const inputRef = useRef<HTMLInputElement>(null)

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
      <label
        data-testid="cmd-bar-arg-name"
        className="flex items-center mx-4 my-4"
      >
        <span className="capitalize px-2 py-1 rounded-l bg-chalkboard-100 dark:bg-chalkboard-80 text-chalkboard-10 border-b border-b-chalkboard-100 dark:border-b-chalkboard-80">
          {arg.displayName || arg.name}
        </span>
        <input
          data-testid="cmd-bar-arg-value"
          id="arg-form"
          name={arg.inputType}
          ref={inputRef}
          type={arg.inputType}
          required
          className="flex-grow px-2 py-1 border-b border-b-chalkboard-100 dark:border-b-chalkboard-80 !bg-transparent focus:outline-none"
          placeholder="Enter a value"
          defaultValue={
            (commandBarState.context.argumentsToSubmit[arg.name] as
              | string
              | undefined) || (arg.defaultValue as string)
          }
          onKeyDown={(event) => {
            if (event.key === 'Backspace' && event.shiftKey) {
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
