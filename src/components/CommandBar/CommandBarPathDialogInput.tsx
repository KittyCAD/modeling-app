import { useEffect, useRef, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'

import { ActionButton } from '@src/components/ActionButton'
import type { CommandArgument } from '@src/lib/commandTypes'
import { isDesktop } from '@src/lib/isDesktop'
import { reportRejection } from '@src/lib/trap'
import {
  commandBarActor,
  useCommandBarState,
} from '@src/machines/commandBarMachine'

function CommandBarPathDialogInput({
  arg,
  stepBack,
  onSubmit,
}: {
  arg: CommandArgument<unknown> & {
    inputType: 'pathDialog'
    name: string
  }
  stepBack: () => void
  onSubmit: (event: unknown) => void
}) {
  const commandBarState = useCommandBarState()
  useHotkeys('mod + k, mod + /', () => commandBarActor.send({ type: 'Close' }))
  const inputRef = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState<string>(
    (commandBarState.context.argumentsToSubmit[arg.name] as
      | string
      | undefined) || (arg.defaultValue as string)
  )

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

  function onPickFile() {
    if (!isDesktop()) {
      return
    }

    window.electron
      .open({
        properties: ['openFile'],
        title: 'Pick a file to load into the current project',
      })
      .then((newPath) => {
        if (newPath.canceled || !newPath.filePaths[0]) {
          return
        }
        setValue(newPath.filePaths[0])
      })
      .catch(reportRejection)
  }

  return (
    <form id="arg-form" onSubmit={handleSubmit}>
      <ActionButton
        className="mx-4 my-4"
        Element="button"
        iconStart={{
          icon: 'file',
        }}
        name="insert"
        onClick={onPickFile}
        autoFocus
      >
        Pick a file
      </ActionButton>
      <label
        data-testid="cmd-bar-arg-name"
        className="flex items-center mx-4 my-4"
      >
        <span className="capitalize px-2 py-1 rounded-l bg-chalkboard-100 dark:bg-chalkboard-80 text-chalkboard-10 border-b border-b-chalkboard-100 dark:border-b-chalkboard-80">
          {arg.displayName || arg.name}
        </span>
        <input
          type="text"
          data-testid="cmd-bar-arg-value"
          id="arg-form"
          name={arg.inputType}
          ref={inputRef}
          required
          className="flex-grow px-2 py-1 border-b border-b-chalkboard-100 dark:border-b-chalkboard-80 !bg-transparent focus:outline-none"
          onKeyDown={(event) => {
            if (event.key === 'Backspace' && event.shiftKey) {
              stepBack()
            }
          }}
          value={value}
        />
      </label>
    </form>
  )
}

export default CommandBarPathDialogInput
