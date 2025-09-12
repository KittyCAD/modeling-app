import { useEffect, useMemo, useRef } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'

import { ActionButton } from '@src/components/ActionButton'
import type { CommandArgument } from '@src/lib/commandTypes'
import { commandBarActor, useCommandBarState } from '@src/lib/singletons'
import { reportRejection } from '@src/lib/trap'
import { isArray, toSync } from '@src/lib/utils'
import { useSelector } from '@xstate/react'
import type { OpenDialogOptions } from 'electron'
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
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
      const configuration: OpenDialogOptions = {
        properties: ['openFile'],
        title: 'Pick a file to load into the current project',
      }

      if (arg.filters) {
        configuration.filters = arg.filters
      }

      if (!window.electron) {
        return new Error("Can't open file picker without electron")
      }
      const newPath = await window.electron.open(configuration)
      if (newPath.canceled) return
      inputRef.current.value = newPath.filePaths[0]
    } else {
      return new Error("Couldn't find inputRef")
    }
  }

  // Fire on component mount, if outside of e2e test context
  useEffect(() => {
    window.electron?.process.env.NODE_ENV !== 'test' &&
      toSync(pickFileThroughNativeDialog, reportRejection)()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
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
