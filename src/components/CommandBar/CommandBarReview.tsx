import { useHotkeys } from 'react-hotkeys-hook'

import CommandBarDivider from '@src/components/CommandBar/CommandBarDivider'
import CommandBarHeaderFooter from '@src/components/CommandBar/CommandBarHeaderFooter'
import { CodemodReviewDiff } from '@src/components/CommandBar/CodemodReviewDiff'
import { evaluateCommandBarArg } from '@src/components/CommandBar/utils'
import { CustomIcon } from '@src/components/CustomIcon'
import Tooltip from '@src/components/Tooltip'
import { noAutofillFormProps, noAutofillInputProps } from '@src/lib/autofill'
import { useApp } from '@src/lib/boot'
import { useResolvedTheme } from '@src/hooks/useResolvedTheme'
import type { CommandArgument } from '@src/lib/commandTypes'
import { useMemo } from 'react'

function validationErrorParts(error: string) {
  const separatorIndex = error.indexOf(': ')
  if (separatorIndex < 1) {
    return { message: error }
  }

  return {
    category: error.slice(0, separatorIndex),
    message: error.slice(separatorIndex + 2),
  }
}

function CommandBarReview({ stepBack }: { stepBack: () => void }) {
  const { commands } = useApp()
  const resolvedTheme = useResolvedTheme()
  const commandBarState = commands.useState()
  const {
    context: {
      argumentsToSubmit,
      selectedCommand,
      reviewValidationError,
      reviewValidationDetails,
    },
  } = commandBarState

  useHotkeys('backspace+meta', stepBack, {
    enableOnFormTags: true,
    enableOnContentEditable: true,
  })
  useHotkeys('esc', () => commands.send({ type: 'Close' }), {
    enableOnFormTags: true,
    enableOnContentEditable: true,
  })

  const visibleArgEntries = useMemo<
    [string, CommandArgument<unknown>][]
  >(() => {
    if (!selectedCommand?.args) return []
    return Object.entries(selectedCommand.args).filter(([name, arg]) => {
      const { isHidden } = evaluateCommandBarArg(
        name,
        arg,
        commandBarState.context
      )
      return !isHidden
    })
  }, [selectedCommand, commandBarState.context])

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
        const argEntry = visibleArgEntries[parseInt(b.keys[0], 10) - 1]
        if (!argEntry) return
        const [argName, arg] = argEntry
        commands.send({
          type: 'Edit argument',
          data: { arg: { ...arg, name: argName } },
        })
      }
    },
    { keyup: true, enableOnFormTags: true, enableOnContentEditable: true },
    [argumentsToSubmit, selectedCommand, visibleArgEntries]
  )

  Object.keys(argumentsToSubmit).forEach((key, _i) => {
    const arg = selectedCommand?.args ? selectedCommand?.args[key] : undefined
    if (!arg) return
  })

  function submitCommand(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    commands.send({
      type: 'Submit command',
      output: { argumentsToSubmit },
    })
  }

  const availableOptionalArgs = useMemo<
    Record<string, CommandArgument<unknown>> | undefined
  >(() => {
    if (!selectedCommand?.args) return undefined
    const s = {
      ...selectedCommand.args,
    } as Record<string, CommandArgument<unknown>>
    for (const [name, arg] of Object.entries(s)) {
      const { isHidden, isRequired, value } = evaluateCommandBarArg(
        name,
        arg,
        commandBarState.context
      )
      if (isHidden || isRequired || value !== undefined) {
        delete s[name]
      }
    }
    return s
  }, [selectedCommand, commandBarState.context])
  const validationError = reviewValidationError
    ? validationErrorParts(reviewValidationError)
    : undefined

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
      {selectedCommand?.status === 'deprecated' && (
        <>
          <p className="px-4 py-2 text-sm">
            <span className="font-bold">Warning: </span>
            <span>
              this command is deprecated and may be removed in a future version
              of Zoo Design Studio. Prefer the recommended replacement when one
              is available.
            </span>
          </p>
          <CommandBarDivider />
        </>
      )}
      {Object.entries(availableOptionalArgs || {}).length > 0 && (
        <>
          <div className="px-4 flex flex-wrap gap-2 items-center">
            <span className="text-sm mr-4">Arguments</span>
            {Object.entries(availableOptionalArgs || {}).map(
              ([argName, arg]) => {
                return (
                  <button
                    data-testid={`cmd-bar-add-optional-arg-${argName}`}
                    type="button"
                    onClick={() => {
                      commands.send({
                        type: 'Edit argument',
                        data: { arg: { ...arg, name: argName } },
                      })
                    }}
                    key={argName}
                    className="w-fit px-2 py-1 m-0 rounded-sm flex gap-2 items-center border"
                  >
                    {arg.status === 'experimental' && (
                      <span className="inline-flex items-center">
                        <CustomIcon name="beaker" className="w-3.5 h-3.5" />
                        <Tooltip
                          position="bottom"
                          contentClassName="max-w-none flex items-center"
                        >
                          <span>Experimental</span>
                        </Tooltip>
                      </span>
                    )}
                    {arg.status === 'deprecated' && (
                      <span className="inline-flex items-center text-warn-80 dark:text-warn-40">
                        <CustomIcon
                          name="triangleExclamation"
                          className="w-3.5 h-3.5"
                        />
                        <Tooltip
                          position="bottom"
                          contentClassName="max-w-none flex items-center"
                        >
                          <span>{arg.statusMessage ?? 'Deprecated'}</span>
                        </Tooltip>
                      </span>
                    )}
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
      {validationError && (
        <>
          <div
            role="alert"
            className="mx-4 my-3 flex items-start gap-3 rounded-md border border-destroy-30 bg-destroy-10/40 px-3 py-2.5 dark:border-destroy-70 dark:bg-destroy-80/15"
          >
            <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-destroy-20/70 text-destroy-80 dark:bg-destroy-80/60 dark:text-destroy-20">
              <CustomIcon name="triangleExclamation" className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="font-medium text-sm text-destroy-80 dark:text-destroy-20">
                Check these arguments
              </p>
              <p
                className="mt-0.5 break-words text-sm leading-5 text-chalkboard-80 dark:text-chalkboard-20"
                data-testid="cmd-bar-review-validation-error"
              >
                {validationError.category && (
                  <>
                    <span className="mr-1 inline-flex rounded bg-destroy-20/60 px-1.5 py-0.5 text-[11px] font-medium leading-none capitalize text-destroy-80 dark:bg-destroy-80/50 dark:text-destroy-20">
                      {validationError.category}:
                    </span>{' '}
                  </>
                )}
                {validationError.message}
              </p>
            </div>
          </div>
          {reviewValidationDetails?.type === 'codemod' && (
            <CodemodReviewDiff
              details={reviewValidationDetails}
              resolvedTheme={resolvedTheme}
            />
          )}
          <CommandBarDivider />
        </>
      )}
      <form
        {...noAutofillFormProps}
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
              {...noAutofillInputProps}
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
