import { useHotkeys } from 'react-hotkeys-hook'

import CommandBarDivider from '@src/components/CommandBar/CommandBarDivider'
import CommandBarHeaderFooter from '@src/components/CommandBar/CommandBarHeaderFooter'
import { evaluateCommandBarArg } from '@src/components/CommandBar/utils'
import { CustomIcon } from '@src/components/CustomIcon'
import Tooltip from '@src/components/Tooltip'
import { noAutofillFormProps, noAutofillInputProps } from '@src/lib/autofill'
import { useApp } from '@src/lib/boot'
import type { CommandArgument } from '@src/lib/commandTypes'
import { useMemo } from 'react'

function CommandBarReview({ stepBack }: { stepBack: () => void }) {
  const { commands } = useApp()
  const commandBarState = commands.useState()
  const {
    context: { argumentsToSubmit, selectedCommand, reviewValidationError },
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
