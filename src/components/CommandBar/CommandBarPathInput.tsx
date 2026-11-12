import { use, useEffect, useMemo, useRef, useState } from 'react'

import { ActionButton } from '@src/components/ActionButton'
import { noAutofillFormProps, noAutofillInputProps } from '@src/lib/autofill'
import { useApp } from '@src/lib/boot'
import type { CommandArgument } from '@src/lib/commandTypes'
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
  const { wasmPromise, commands } = useApp()
  const wasmInstance = use(wasmPromise)
  const commandBarState = commands.useState()
  const inputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [selectedFile, setSelectedFile] = useState<File | undefined>(() => {
    const value = commandBarState.context.argumentsToSubmit[arg.name]
    return value instanceof File ? value : undefined
  })
  const argMachineContext = useSelector(
    arg.machineActor,
    machineContextSelector
  )
  const defaultValue = useMemo(
    () =>
      arg.defaultValue
        ? arg.defaultValue instanceof Function
          ? arg.defaultValue(
              commandBarState.context,
              argMachineContext,
              wasmInstance
            )
          : arg.defaultValue
        : '',
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
    [arg.defaultValue, commandBarState.context, argMachineContext, wasmInstance]
  )

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const value = window.electron ? inputRef.current?.value : selectedFile
    if (value) onSubmit(value)
  }

  async function pickFile() {
    if (!window.electron) {
      fileInputRef.current?.click()
      return
    }
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

      const newPath = await window.electron.open(configuration)
      if (newPath.canceled) return
      inputRef.current.value = newPath.filePaths[0]
    } else {
      return new Error("Couldn't find inputRef")
    }
  }

  // Open the picker when entering this argument; desktop tests use seeded paths.
  useEffect(() => {
    if (window.electron?.process.env.NODE_ENV !== 'test') {
      toSync(pickFile, reportRejection)()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
  }, [])

  return (
    <form {...noAutofillFormProps} id="arg-form" onSubmit={handleSubmit}>
      <div className="flex items-center mx-4 my-4 border-b border-b-chalkboard-100 dark:border-b-chalkboard-80">
        <label
          htmlFor="cmd-bar-path-input"
          data-testid="cmd-bar-arg-name"
          className="capitalize px-2 py-1 bg-chalkboard-100 dark:bg-chalkboard-80 text-chalkboard-10"
        >
          {arg.displayName || arg.name}
        </label>
        <input
          {...noAutofillInputProps}
          type="text"
          data-testid="cmd-bar-arg-value"
          id="cmd-bar-path-input"
          name={arg.inputType}
          ref={inputRef}
          required
          className="flex-grow px-2 py-1 !bg-transparent focus:outline-none"
          placeholder="Choose a file"
          readOnly={!window.electron}
          defaultValue={window.electron ? defaultValue : undefined}
          value={window.electron ? undefined : selectedFile?.name || ''}
          onKeyDown={(event) => {
            if (event.key === 'Backspace' && event.metaKey) {
              stepBack()
            }
          }}
        />
        {!window.electron && (
          <input
            ref={fileInputRef}
            type="file"
            aria-label="Choose a file"
            hidden
            onChange={(event) => {
              const file = event.currentTarget.files?.[0]
              if (file) setSelectedFile(file)
              event.currentTarget.value = ''
            }}
          />
        )}
        <ActionButton
          Element="button"
          type="button"
          tabIndex={0}
          aria-label="Open file"
          onClick={toSync(pickFile, reportRejection)}
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
      </div>
    </form>
  )
}

export default CommandBarPathInput
