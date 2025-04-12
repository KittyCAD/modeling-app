import { useRef, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'

import { CustomIcon } from '@src/components/CustomIcon'
import Tooltip from '@src/components/Tooltip'
import type { CommandArgument } from '@src/lib/commandTypes'
import { reportRejection } from '@src/lib/trap'
import { isArray, toSync } from '@src/lib/utils'
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
        <button
          autoFocus
          onClick={toSync(async () => {
            // TODO: unify with src/lib/settings/initialSettings.tsx
            // In desktop end-to-end tests we can't control the file picker,
            // so we seed the new directory value in the element's dataset
            const inputRefVal = inputRef.current?.dataset.testValue
            if (inputRef.current && inputRefVal && !isArray(inputRefVal)) {
              setValue(inputRefVal)
            } else {
              const newPath = await window.electron.open({
                properties: ['openFile'],
                title: 'Pick a file to load into the current project',
              })
              if (newPath.canceled) return
              setValue(newPath.filePaths[0])
            }
          }, reportRejection)}
          className="p-0 m-0 border-none hover:bg-primary/10 focus:bg-primary/10 dark:hover:bg-primary/20 dark:focus::bg-primary/20"
          data-testid="cmd-bar-arg-file-button"
        >
          <CustomIcon name="file" className="w-5 h-5" />
          <Tooltip position="top-right">Choose a file</Tooltip>
        </button>
      </label>
    </form>
  )
}

export default CommandBarPathDialogInput
