import { useHotkeys } from 'react-hotkeys-hook'

import CommandBarDivider from '@src/components/CommandBar/CommandBarDivider'
import CommandBarHeaderFooter from '@src/components/CommandBar/CommandBarHeaderFooter'
import { CustomIcon } from '@src/components/CustomIcon'
import { commandBarActor, useCommandBarState } from '@src/lib/singletons'
import { useEffect, useMemo, useState } from 'react'
import { evaluateCommandBarArg } from '@src/components/CommandBar/utils'

function CommandBarReview({ stepBack }: { stepBack: () => void }) {
  const commandBarState = useCommandBarState()
  const {
    context: { argumentsToSubmit, selectedCommand },
  } = commandBarState

  // TODO: figure out if we really want to add state here?
  const [reviewMessage, setReviewMessage] = useState<
    string | React.ReactNode | undefined
  >()
  const [reviewError, setReviewError] = useState<string | undefined>()

  useHotkeys('backspace+meta', stepBack, {
    enableOnFormTags: true,
    enableOnContentEditable: true,
  })

  useHotkeys(
    [
      'alt+1',
      'alt+2',
      'alt+3',
      'alt+4',
      'alt+5',
      'alt+6',
      'alt+7',
      'alt+8',
      'alt+9',
      'alt+0',
    ],
    (_, b) => {
      if (b.keys && !Number.isNaN(parseInt(b.keys[0], 10))) {
        if (!selectedCommand?.args) return
        const argName = Object.keys(selectedCommand.args)[
          parseInt(b.keys[0], 10) - 1
        ]
        const arg = selectedCommand?.args[argName]
        commandBarActor.send({
          type: 'Edit argument',
          data: { arg: { ...arg, name: argName } },
        })
      }
    },
    { keyup: true, enableOnFormTags: true, enableOnContentEditable: true },
    [argumentsToSubmit, selectedCommand]
  )

  Object.keys(argumentsToSubmit).forEach((key, _i) => {
    const arg = selectedCommand?.args ? selectedCommand?.args[key] : undefined
    if (!arg) return
  })

  function submitCommand(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    commandBarActor.send({
      type: 'Submit command',
      output: argumentsToSubmit,
    })
  }

  useEffect(() => {
    if (selectedCommand?.reviewMessage instanceof Function) {
      selectedCommand
        .reviewMessage(commandBarState.context)
        .then((msg) => {
          setReviewMessage(msg)
          setReviewError(undefined)
        })
        .catch((err: Error) => {
          console.error('Error getting review message:', err)
          setReviewMessage(undefined)
          setReviewError(err.message)
        })
    } else {
      setReviewMessage(selectedCommand?.reviewMessage)
      setReviewError(undefined)
    }
  }, [selectedCommand, commandBarState.context])

  const availableOptionalArgs = useMemo(() => {
    if (!selectedCommand?.args) return undefined
    const s = { ...selectedCommand.args }
    for (const [name, arg] of Object.entries(s)) {
      const { isHidden, isRequired, value } = evaluateCommandBarArg(
        name,
        arg,
        commandBarState.context
      )
      if (isHidden || isRequired || value) {
        delete s[name]
      }
    }
    return s
  }, [selectedCommand, commandBarState.context])
  return (
    <CommandBarHeaderFooter stepBack={stepBack} submitDisabled={!!reviewError}>
      {reviewMessage && (
        <>
          <p className="px-4 py-2 text-sm">{reviewMessage}</p>
          <CommandBarDivider />
        </>
      )}
      {reviewError && (
        <>
          <p className="px-4 py-2 text-red-500/50 text-sm">{reviewError}</p>
          <CommandBarDivider />
        </>
      )}
      {Object.entries(availableOptionalArgs || {}).length > 0 && (
        <>
          <div className="px-4 flex flex-wrap gap-2 items-baseline">
            <span className="text-sm mr-4">Arguments</span>
            {Object.entries(availableOptionalArgs || {}).map(
              ([argName, arg]) => {
                return (
                  <button
                    data-testid={`cmd-bar-add-optional-arg-${argName}`}
                    type="button"
                    onClick={() => {
                      commandBarActor.send({
                        type: 'Edit argument',
                        data: { arg: { ...arg, name: argName } },
                      })
                    }}
                    key={argName}
                    className="w-fit px-2 py-1 m-0 rounded-sm flex gap-2 items-center border"
                  >
                    <span className="capitalize">
                      {arg.displayName || argName}
                    </span>
                    <CustomIcon name="plus" className="w-4 h-4" />
                  </button>
                )
              }
            )}
          </div>
          <CommandBarDivider />
        </>
      )}
      <form
        id="review-form"
        className="absolute opacity-0 inset-0 pointer-events-none"
        onSubmit={submitCommand}
      >
        {Object.entries(argumentsToSubmit).map(([key, value], _i) => {
          const arg = selectedCommand?.args
            ? selectedCommand?.args[key]
            : undefined
          if (!arg) return null

          return (
            <input
              id={key}
              name={key}
              key={key}
              type="text"
              defaultValue={
                typeof value === 'object'
                  ? JSON.stringify(value)
                  : (value as string)
              }
              hidden
            />
          )
        })}
      </form>
    </CommandBarHeaderFooter>
  )
}

export default CommandBarReview
