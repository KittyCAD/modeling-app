import { CommandArgument } from 'lib/commandTypes'
import { commandBarActor, useCommandBarState } from 'machines/commandBarMachine'
import { RefObject, useEffect, useRef } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'

function CommandBarTextareaInput({
  arg,
  stepBack,
  onSubmit,
}: {
  arg: CommandArgument<unknown> & {
    inputType: 'text'
    name: string
  }
  stepBack: () => void
  onSubmit: (event: unknown) => void
}) {
  const commandBarState = useCommandBarState()
  useHotkeys('mod + k, mod + /', () => commandBarActor.send({ type: 'Close' }))
  const formRef = useRef<HTMLFormElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  useTextareaAutoGrow(inputRef)

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
    <form id="arg-form" onSubmit={handleSubmit} ref={formRef}>
      <label className="flex items-start rounded mx-4 my-4 border border-chalkboard-100 dark:border-chalkboard-80">
        <span
          data-testid="cmd-bar-arg-name"
          className="capitalize px-2 py-1 rounded-br bg-chalkboard-100 dark:bg-chalkboard-80 text-chalkboard-10 border-b border-b-chalkboard-100 dark:border-b-chalkboard-80"
        >
          {arg.name}
        </span>
        <textarea
          data-testid="cmd-bar-arg-value"
          id="arg-form"
          name={arg.inputType}
          ref={inputRef}
          required
          className="flex-grow mx-2 my-1 !bg-transparent focus:outline-none min-h-12"
          placeholder="Enter a value"
          defaultValue={
            (commandBarState.context.argumentsToSubmit[arg.name] as
              | string
              | undefined) || (arg.defaultValue as string)
          }
          onKeyDown={(event) => {
            if (
              event.key === 'Backspace' &&
              event.shiftKey &&
              !event.currentTarget.value
            ) {
              stepBack()
            } else if (
              event.key === 'Enter' &&
              (event.metaKey || event.shiftKey)
            ) {
              // Insert a newline
              event.preventDefault()
              const target = event.currentTarget
              const value = target.value
              const selectionStart = target.selectionStart
              const selectionEnd = target.selectionEnd
              target.value =
                value.substring(0, selectionStart) +
                '\n' +
                value.substring(selectionEnd)
              target.selectionStart = selectionStart + 1
              target.selectionEnd = selectionStart + 1
            } else if (event.key === 'Enter') {
              event.preventDefault()
              formRef.current?.dispatchEvent(
                new Event('submit', { bubbles: true })
              )
            }
          }}
          autoFocus
        />
      </label>
    </form>
  )
}

/**
 * Modified from https://www.reddit.com/r/reactjs/comments/twmild/comment/i3jf330/?utm_source=share&utm_medium=web3x&utm_name=web3xcss&utm_term=1&utm_content=share_button
 * Thank you to @sidkh for the original code
 */
const useTextareaAutoGrow = (ref: RefObject<HTMLTextAreaElement>) => {
  useEffect(() => {
    const listener = () => {
      if (ref.current === null) return
      ref.current.style.padding = '0px'
      ref.current.style.height = ref.current.scrollHeight + 'px'
      ref.current.style.removeProperty('padding')
    }

    if (ref.current === null) return
    ref.current.addEventListener('input', listener)

    return () => {
      if (ref.current === null) return
      ref.current.removeEventListener('input', listener)
    }
  }, [ref.current])
}

export default CommandBarTextareaInput
