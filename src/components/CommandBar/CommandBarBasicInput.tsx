import { useSelector } from '@xstate/react'
import { use, useEffect, useMemo, useRef } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'

import type { CommandArgument } from '@src/lib/commandTypes'
import {
  commandBarActor,
  kclManager,
  useCommandBarState,
} from '@src/lib/singletons'
import { Marked } from '@ts-stack/markdown'
import type { AnyStateMachine, SnapshotFrom } from 'xstate'

// TODO: remove the need for this selector once we decouple all actors from React
const machineContextSelector = (snapshot?: SnapshotFrom<AnyStateMachine>) =>
  snapshot?.context

function CommandBarBasicInput({
  arg,
  stepBack,
  onSubmit,
}: {
  arg: CommandArgument<unknown> & {
    inputType: 'string' | 'color' | 'tagDeclarator'
    name: string
  }
  stepBack: () => void
  onSubmit: (event: unknown) => void
}) {
  const wasmInstance = use(kclManager.wasmInstancePromise)
  const commandBarState = useCommandBarState()
  const previouslySetValue = commandBarState.context.argumentsToSubmit[
    arg.name
  ] as string | undefined
  useHotkeys('mod + k, mod + /', () => commandBarActor.send({ type: 'Close' }))
  const inputRef = useRef<HTMLInputElement>(null)
  const argMachineContext = useSelector(
    arg.machineActor,
    machineContextSelector
  )
  const defaultValue = useMemo(
    () =>
      previouslySetValue ||
      (arg.defaultValue
        ? arg.defaultValue instanceof Function
          ? arg.defaultValue(
              commandBarState.context,
              argMachineContext,
              wasmInstance
            )
          : arg.defaultValue
        : ''),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
    [
      arg.defaultValue,
      commandBarState.context,
      argMachineContext,
      previouslySetValue,
      wasmInstance,
    ]
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

  return (
    <form id="arg-form" onSubmit={handleSubmit} className="flex flex-col">
      <label
        data-testid="cmd-bar-arg-name"
        className="flex items-center mx-4 my-4"
      >
        <span className="capitalize px-2 py-1 rounded-l bg-chalkboard-100 dark:bg-chalkboard-80 text-chalkboard-10 border-b border-b-chalkboard-100 dark:border-b-chalkboard-80">
          {arg.displayName || arg.name}
        </span>
        {arg.inputType === 'tagDeclarator' && (
          <span className="pl-2 py-1 -mr-2 border-b border-b-chalkboard-100 dark:border-b-chalkboard-80">
            $
          </span>
        )}
        <input
          data-testid="cmd-bar-arg-value"
          id="arg-form"
          name={arg.inputType}
          ref={inputRef}
          type={arg.inputType}
          required
          className={`flex-grow ${arg.inputType === 'color' ? 'h-[41px]' : 'px-2 py-1 border-b border-b-chalkboard-100 dark:border-b-chalkboard-80'} !bg-transparent focus:outline-none`}
          placeholder="Enter a value"
          defaultValue={defaultValue}
          data-1p-ignore
          data-lpignore="true"
          data-form-type="other"
          data-bwignore
          onKeyDown={(event) => {
            if (event.key === 'Backspace' && event.metaKey) {
              stepBack()
            }
          }}
          autoFocus
        />
      </label>
      {arg.description && (
        <div
          className="mx-4 mb-4 mt-2 text-sm leading-relaxed text-chalkboard-70 dark:text-chalkboard-40 parsed-markdown [&_strong]:font-semibold [&_strong]:text-chalkboard-90 dark:[&_strong]:text-chalkboard-20"
          dangerouslySetInnerHTML={{
            __html: Marked.parse(arg.description, {
              gfm: true,
              breaks: true,
            }),
          }}
        />
      )}
    </form>
  )
}

export default CommandBarBasicInput
