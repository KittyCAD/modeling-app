import { use, useCallback, useEffect, useRef, useState } from 'react'

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
  const hasUserEditedRef = useRef(false)
  const [value, setValue] = useState('')
  const argMachineContext = useSelector(
    arg.machineActor,
    machineContextSelector
  )
  const resolveDefaultValue = useCallback(
    async () => {
      const submittedValue = commandBarState.context.argumentsToSubmit[arg.name]
      if (submittedValue !== undefined) {
        const value =
          submittedValue instanceof Function
            ? submittedValue(
                commandBarState.context,
                argMachineContext,
                wasmInstance
              )
            : submittedValue
        return String((await value) ?? '')
      }

      if (!arg.defaultValue) {
        return ''
      }

      const defaultValue =
        arg.defaultValue instanceof Function
          ? arg.defaultValue(
              commandBarState.context,
              argMachineContext,
              wasmInstance
            )
          : arg.defaultValue

      return String((await defaultValue) ?? '')
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
    [arg.defaultValue, commandBarState.context, argMachineContext, wasmInstance]
  )
  const opensDirectory =
    arg.openDialogProperties?.includes('openDirectory') ?? false

  useEffect(() => {
    let cancelled = false

    resolveDefaultValue()
      .then((defaultValue) => {
        if (cancelled || hasUserEditedRef.current) {
          return
        }

        setValue(defaultValue)
      })
      .catch(reportRejection)

    return () => {
      cancelled = true
    }
  }, [resolveDefaultValue])

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    onSubmit(value)
  }

  async function pickFileThroughNativeDialog() {
    // In desktop end-to-end tests we can't control the file picker,
    // so we seed the new directory value in the element's dataset
    const inputRefVal = inputRef.current?.dataset.testValue
    if (inputRef.current && inputRefVal && !isArray(inputRefVal)) {
      hasUserEditedRef.current = true
      setValue(inputRefVal)
    } else if (inputRef.current) {
      const defaultPath = value || (await resolveDefaultValue())
      const configuration: OpenDialogOptions = {
        properties: arg.openDialogProperties ?? ['openFile'],
        title:
          arg.openDialogTitle ?? 'Pick a file to load into the current project',
      }
      if (defaultPath) {
        configuration.defaultPath = defaultPath
      }

      if (arg.filters) {
        configuration.filters = arg.filters
      }

      if (!window.electron) {
        return new Error("Can't open file picker without electron")
      }
      const newPath = await window.electron.open(configuration)
      if (newPath.canceled) {
        return
      }
      hasUserEditedRef.current = true
      setValue(newPath.filePaths[0])
    } else {
      return new Error("Couldn't find inputRef")
    }
  }

  // Fire on component mount, if outside of e2e test context
  useEffect(() => {
    if (window.electron?.process.env.NODE_ENV !== 'test') {
      toSync(pickFileThroughNativeDialog, reportRejection)()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
  }, [])

  return (
    <form {...noAutofillFormProps} id="arg-form" onSubmit={handleSubmit}>
      <label
        data-testid="cmd-bar-arg-name"
        className="flex items-center mx-4 my-4 border-b border-b-chalkboard-100 dark:border-b-chalkboard-80"
      >
        <span className="capitalize px-2 py-1 bg-chalkboard-100 dark:bg-chalkboard-80 text-chalkboard-10">
          {arg.displayName || arg.name}
        </span>
        <input
          {...noAutofillInputProps}
          type="text"
          data-testid="cmd-bar-arg-value"
          id="arg-form"
          name={arg.inputType}
          ref={inputRef}
          required
          className="flex-grow px-2 py-1 !bg-transparent focus:outline-none"
          placeholder="Enter a path"
          value={value}
          onChange={(event) => {
            hasUserEditedRef.current = true
            setValue(event.currentTarget.value)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Backspace' && event.metaKey) {
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
            icon: opensDirectory ? 'folder' : 'file',
            size: 'sm',
            className: 'p-1',
          }}
        >
          {opensDirectory ? 'Open folder' : 'Open file'}
        </ActionButton>
      </label>
    </form>
  )
}

export default CommandBarPathInput
