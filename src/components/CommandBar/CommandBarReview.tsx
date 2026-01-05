import { useHotkeys } from 'react-hotkeys-hook'

import CommandBarDivider from '@src/components/CommandBar/CommandBarDivider'
import CommandBarHeaderFooter from '@src/components/CommandBar/CommandBarHeaderFooter'
import { CustomIcon } from '@src/components/CustomIcon'
import { commandBarActor, useCommandBarState } from '@src/lib/singletons'
import { useMemo } from 'react'
import { evaluateCommandBarArg } from '@src/components/CommandBar/utils'

function CommandBarReview({ stepBack }: { stepBack: () => void }) {
  const commandBarState = useCommandBarState()
  const {
    context: { argumentsToSubmit, selectedCommand, reviewValidationError },
  } = commandBarState

  useHotkeys('backspace+meta', stepBack, {
    enableOnFormTags: true,
    enableOnContentEditable: true,
  })
  useHotkeys('esc', () => commandBarActor.send({ type: 'Close' }), {
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
      output: { argumentsToSubmit },
    })
  }

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
    <CommandBarHeaderFooter
      stepBack={stepBack}
      submitDisabled={!!reviewValidationError}
    >
      {selectedCommand?.reviewMessage && (
        <>
          <p className="px-4 py-2 text-sm">
            {selectedCommand.reviewMessage instanceof Function
              ? selectedCommand.reviewMessage(commandBarState.context)
              : selectedCommand.reviewMessage}
          </p>
          <CommandBarDivider />
        </>
      )}
      {reviewValidationError && (
        <>
          <p
            className="px-4 py-2 text-red-500 text-sm"
            data-testid="cmd-bar-review-validation-error"
          >
            {reviewValidationError}
          </p>
          <CommandBarDivider />
        </>
      )}
      {selectedCommand?.status === 'experimental' && (
        <>
          <p className="px-4 py-2 text-sm">
            <span className="font-bold">Warning: </span>
            <span>
              this command is experimental, which means the feature it generates
              may not be compatible with future versions of Zoo Design Studio.
              Use at your own risk, and please report issues!
            </span>
          </p>
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
