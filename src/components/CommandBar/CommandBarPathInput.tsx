import { useEffect, useMemo, useRef } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'

import { ActionButton } from '@src/components/ActionButton'
import type { CommandArgument } from '@src/lib/commandTypes'
import { reportRejection } from '@src/lib/trap'
import { isArray, toSync } from '@src/lib/utils'
import { commandBarActor, useCommandBarState } from '@src/lib/singletons'
import { useSelector } from '@xstate/react'
import type { AnyStateMachine, SnapshotFrom } from 'xstate'

// TODO: remove the need for this selector once we decouple all actors from React
const machineContextSelector = (snapshot?: SnapshotFrom<AnyStateMachine>) =>
  snapshot?.context

function CommandBarPathInput({
  arg,
  stepBack,
  onSubmit,
}: {
  arg: CommandArgument<unknown> & {
    inputType: 'path'
    name: string
  }
  stepBack: () => void
  onSubmit: (event: unknown) => void
}) {
  const commandBarState = useCommandBarState()
  useHotkeys('mod + k, mod + /', () => commandBarActor.send({ type: 'Close' }))
  const inputRef = useRef<HTMLInputElement>(null)
  const argMachineContext = useSelector(
    arg.machineActor,
    machineContextSelector
  )
  const defaultValue = useMemo(
    () =>
      arg.defaultValue
        ? arg.defaultValue instanceof Function
          ? arg.defaultValue(commandBarState.context, argMachineContext)
          : arg.defaultValue
        : '',
    [arg.defaultValue, commandBarState.context, argMachineContext]
  )

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    onSubmit(inputRef.current?.value)
  }

  async function pickFileThroughNativeDialog() {
    // In desktop end-to-end tests we can't control the file picker,
    // so we seed the new directory value in the element's dataset
    const inputRefVal = inputRef.current?.dataset.testValue
    if (inputRef.current && inputRefVal && !isArray(inputRefVal)) {
      inputRef.current.value = inputRefVal
    } else if (inputRef.current) {
      const newPath = await window.electron.open({
        properties: ['openFile'],
        title: 'Pick a file to load into the current project',
      })
      if (newPath.canceled) return
      inputRef.current.value = newPath.filePaths[0]
    } else {
      return new Error("Couldn't find inputRef")
    }
  }

  // Fire on component mount, if outside of e2e test context
  useEffect(() => {
    window.electron.process.env.IS_PLAYWRIGHT !== 'true' &&
      toSync(pickFileThroughNativeDialog, reportRejection)()
  }, [])

  return (
    <form id="arg-form" onSubmit={handleSubmit}>
      <label
        data-testid="cmd-bar-arg-name"
        className="flex items-center mx-4 my-4 border-b border-b-chalkboard-100 dark:border-b-chalkboard-80"
      >
        <span className="capitalize px-2 py-1 bg-chalkboard-100 dark:bg-chalkboard-80 text-chalkboard-10">
          {arg.displayName || arg.name}
        </span>
        <input
          type="text"
          data-testid="cmd-bar-arg-value"
          id="arg-form"
          name={arg.inputType}
          ref={inputRef}
          required
          className="flex-grow px-2 py-1 !bg-transparent focus:outline-none"
          placeholder="Enter a path"
          defaultValue={defaultValue}
          onKeyDown={(event) => {
            if (event.key === 'Backspace' && event.shiftKey) {
              stepBack()
            }
          }}
        />
        <ActionButton
          Element="button"
          onClick={toSync(pickFileThroughNativeDialog, reportRejection)}
          className="p-0 m-0 border-none hover:bg-primary/10 focus:bg-primary/10 dark:hover:bg-primary/20 dark:focus::bg-primary/20"
          data-testid="cmd-bar-arg-file-button"
          iconEnd={{
            icon: 'file',
            size: 'sm',
            className: 'p-1',
          }}
        >
          Open file
        </ActionButton>
      </label>
    </form>
  )
}

export default CommandBarPathInput
