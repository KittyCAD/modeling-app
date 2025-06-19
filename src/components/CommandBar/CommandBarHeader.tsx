import type React from 'react'
import { useMemo, useEffect, useRef, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'

import { ActionButton } from '@src/components/ActionButton'
import { CustomIcon } from '@src/components/CustomIcon'
import Tooltip from '@src/components/Tooltip'
import type {
  KclCommandValue,
  KclExpressionWithVariable,
} from '@src/lib/commandTypes'
import type { Selections } from '@src/lib/selections'
import { getSelectionTypeDisplayText } from '@src/lib/selections'
import { roundOff } from '@src/lib/utils'
import { commandBarActor, useCommandBarState } from '@src/lib/singletons'

function CommandBarHeader({
  children,
  stepBack,
}: React.PropsWithChildren<object> & { stepBack: () => void }) {
  const commandBarState = useCommandBarState()
  const {
    context: { selectedCommand, currentArgument, argumentsToSubmit },
  } = commandBarState
  const nonHiddenArgs = useMemo(() => {
    if (!selectedCommand?.args) return undefined
    const s = { ...selectedCommand.args }
    for (const [name, arg] of Object.entries(s)) {
      if (
        typeof arg.hidden === 'function'
          ? arg.hidden(commandBarState.context)
          : arg.hidden
      )
        delete s[name]
    }
    return s
  }, [selectedCommand])
  const isReviewing = commandBarState.matches('Review')
  const [showShortcuts, setShowShortcuts] = useState(false)

  useHotkeys(
    'alt',
    () => setShowShortcuts(true),
    { enableOnFormTags: true, enableOnContentEditable: true },
    [showShortcuts]
  )
  useHotkeys(
    'alt',
    () => setShowShortcuts(false),
    { keyup: true, enableOnFormTags: true, enableOnContentEditable: true },
    [showShortcuts]
  )
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
        if (!nonHiddenArgs) return
        const argName = Object.keys(nonHiddenArgs)[parseInt(b.keys[0], 10) - 1]
        const arg = nonHiddenArgs[argName]
        if (!argName || !arg) return
        commandBarActor.send({
          type: 'Change current argument',
          data: { arg: { ...arg, name: argName } },
        })
      }
    },
    { keyup: true, enableOnFormTags: true, enableOnContentEditable: true },
    [argumentsToSubmit, selectedCommand]
  )

  const availableOptionalArgs = Object.entries(nonHiddenArgs || {}).filter(
    ([argName, arg]) => {
      const argValue =
        (typeof argumentsToSubmit[argName] === 'function'
          ? argumentsToSubmit[argName](commandBarState.context)
          : argumentsToSubmit[argName]) || ''
      const isRequired =
        typeof arg.required === 'function'
          ? arg.required(commandBarState.context)
          : arg.required

      return !(isRequired || argValue)
    }
  )
  return (
    selectedCommand &&
    argumentsToSubmit && (
      <>
        <div className="group px-4 text-sm flex gap-4 items-start">
          <div className="flex flex-1 flex-wrap gap-2">
            <p
              data-command-name={selectedCommand?.name}
              className="pr-2 flex gap-2 items-center"
            >
              {selectedCommand &&
                'icon' in selectedCommand &&
                selectedCommand.icon && (
                  <CustomIcon name={selectedCommand.icon} className="w-5 h-5" />
                )}
              <span data-testid="command-name">
                {selectedCommand.displayName || selectedCommand.name}
              </span>
              {selectedCommand.status === 'experimental' ? (
                <span className="uppercase text-xs rounded-full ml-2 px-2 py-1 border border-ml-green dark:text-ml-green">
                  experimental
                </span>
              ) : (
                <span className="pr-2" />
              )}
            </p>
            {Object.entries(nonHiddenArgs || {}).flatMap(
              ([argName, arg], i) => {
                const argValue =
                  (typeof argumentsToSubmit[argName] === 'function'
                    ? argumentsToSubmit[argName](commandBarState.context)
                    : argumentsToSubmit[argName]) || ''
                const isCurrentArg = argName === currentArgument?.name
                const isSkipFalse = arg.skip === false
                const isRequired =
                  typeof arg.required === 'function'
                    ? arg.required(commandBarState.context)
                    : arg.required

                if (!(argValue || isCurrentArg || isSkipFalse || isRequired)) {
                  return []
                }

                return (
                  <button
                    data-testid="cmd-bar-input-tab"
                    data-is-current-arg={
                      argName === currentArgument?.name ? 'true' : 'false'
                    }
                    type="button"
                    disabled={!isReviewing && currentArgument?.name === argName}
                    onClick={() => {
                      commandBarActor.send({
                        type: isReviewing
                          ? 'Edit argument'
                          : 'Change current argument',
                        data: { arg: { ...arg, name: argName } },
                      })
                    }}
                    key={argName}
                    className={`relative w-fit px-2 py-1 rounded-sm flex gap-2 items-center border ${
                      argName === currentArgument?.name
                        ? selectedCommand.status === 'experimental'
                          ? 'disabled:bg-ml-green/10 dark:disabled:bg-ml-green/20 disabled:border-ml-green dark:disabled:border-ml-green disabled:text-chalkboard-100 dark:disabled:text-chalkboard-10'
                          : 'disabled:bg-primary/10 dark:disabled:bg-primary/20 disabled:border-primary dark:disabled:border-primary disabled:text-chalkboard-100 dark:disabled:text-chalkboard-10'
                        : 'bg-chalkboard-20/50 dark:bg-chalkboard-80/50 border-chalkboard-20 dark:border-chalkboard-80'
                    }`}
                  >
                    <span
                      data-testid={`arg-name-${argName.toLowerCase()}`}
                      data-test-name="arg-name"
                      className="capitalize"
                    >
                      {arg.displayName || argName}
                    </span>
                    <span className="sr-only">:&nbsp;</span>
                    <span data-testid="header-arg-value">
                      {argValue ? (
                        arg.inputType === 'selection' ||
                        arg.inputType === 'selectionMixed' ? (
                          getSelectionTypeDisplayText(argValue as Selections)
                        ) : arg.inputType === 'kcl' ? (
                          roundOff(
                            Number(
                              (argValue as KclCommandValue).valueCalculated
                            ),
                            4
                          )
                        ) : arg.inputType === 'text' &&
                          !arg.valueSummary &&
                          typeof argValue === 'string' ? (
                          `${argValue.slice(0, 12)}${argValue.length > 12 ? '...' : ''}`
                        ) : typeof argValue === 'object' ? (
                          arg.valueSummary ? (
                            arg.valueSummary(argValue)
                          ) : (
                            JSON.stringify(argValue)
                          )
                        ) : (
                          <em>
                            {arg.valueSummary
                              ? arg.valueSummary(argValue)
                              : argValue}
                          </em>
                        )
                      ) : null}
                    </span>
                    {showShortcuts && (
                      <small className="absolute -top-[1px] right-full translate-x-1/2 px-0.5 rounded-sm bg-chalkboard-80 text-chalkboard-10 dark:bg-primary dark:text-chalkboard-100">
                        <span className="sr-only">Hotkey: </span>
                        {i + 1}
                      </small>
                    )}
                    {arg.inputType === 'kcl' &&
                      !!argValue &&
                      typeof argValue === 'object' &&
                      'variableName' in (argValue as KclCommandValue) && (
                        <>
                          <CustomIcon
                            name="make-variable"
                            className="w-4 h-4"
                          />
                          <Tooltip position="bottom">
                            New variable:{' '}
                            {
                              (
                                argumentsToSubmit[
                                  argName
                                ] as KclExpressionWithVariable
                              ).variableName
                            }
                          </Tooltip>
                        </>
                      )}
                  </button>
                )
              }
            )}
          </div>
        </div>
        <div className="block w-full my-2 h-[1px] bg-chalkboard-20 dark:bg-chalkboard-80" />
        {isReviewing && availableOptionalArgs.length > 0 && (
          <>
            <div className="px-4">
              <p className="mb-2">Optional arguments</p>
              <div className="text-sm flex gap-4 items-start">
                <div className="flex flex-1 flex-wrap gap-2">
                  {availableOptionalArgs.map(([argName, arg]) => {
                    return (
                      <button
                        data-testid="cmd-bar-add-optional-arg"
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
                  })}
                </div>
              </div>
            </div>
            <div className="block w-full mt-2 h-[1px] bg-chalkboard-20 dark:bg-chalkboard-80" />
          </>
        )}
        {children}
        <>
          <div className="block w-full mb-2 h-[1px] bg-chalkboard-20 dark:bg-chalkboard-80" />
          <div className="px-4 pb-2 flex justify-between items-center gap-2">
            <ActionButton
              Element="button"
              type="button"
              form="review-form"
              className={`w-fit !p-0 rounded-sm hover:brightness-110 hover:shadow focus:outline-current`}
              tabIndex={0}
              data-testid="command-bar-step-back"
              iconStart={{
                icon: 'arrowLeft',
                bgClassName: `p-1 rounded-sm`,
                iconClassName: ``,
              }}
              onClick={stepBack}
            >
              <Tooltip position="bottom">
                Step back
                <kbd className="hotkey ml-4 dark:!bg-chalkboard-80">Shift</kbd>
                <kbd className="hotkey ml-4 dark:!bg-chalkboard-80">Bksp</kbd>
              </Tooltip>
            </ActionButton>
            {isReviewing ? (
              <ReviewingButton
                bgClassName={
                  selectedCommand.status === 'experimental'
                    ? '!bg-ml-green'
                    : '!bg-primary'
                }
                iconClassName={
                  selectedCommand.status === 'experimental'
                    ? '!text-ml-black'
                    : '!text-chalkboard-10'
                }
              />
            ) : (
              <GatheringArgsButton
                bgClassName={
                  selectedCommand.status === 'experimental'
                    ? '!bg-ml-green'
                    : '!bg-primary'
                }
                iconClassName={
                  selectedCommand.status === 'experimental'
                    ? '!text-ml-black'
                    : '!text-chalkboard-10'
                }
              />
            )}
          </div>
        </>
      </>
    )
  )
}

type ButtonProps = { bgClassName?: string; iconClassName?: string }
function ReviewingButton({ bgClassName, iconClassName }: ButtonProps) {
  const buttonRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (buttonRef.current) {
      buttonRef.current.focus()
    }
  }, [])
  return (
    <ActionButton
      Element="button"
      ref={buttonRef}
      type="submit"
      form="review-form"
      className={`w-fit !p-0 rounded-sm hover:brightness-110 hover:shadow focus:outline-current ${bgClassName}`}
      tabIndex={0}
      data-testid="command-bar-submit"
      iconEnd={{
        icon: 'checkmark',
        bgClassName: `p-1 rounded-sm ${bgClassName}`,
        iconClassName: `${iconClassName}`,
      }}
    >
      <span className={`pl-2 ${iconClassName}`}>Submit</span>
    </ActionButton>
  )
}

function GatheringArgsButton({ bgClassName, iconClassName }: ButtonProps) {
  return (
    <ActionButton
      Element="button"
      type="submit"
      form="arg-form"
      className={`w-fit !p-0 rounded-sm hover:brightness-110 hover:shadow focus:outline-current ${bgClassName}`}
      tabIndex={0}
      data-testid="command-bar-continue"
      iconEnd={{
        icon: 'arrowRight',
        bgClassName: `p-1 rounded-sm ${bgClassName}`,
        iconClassName: `${iconClassName}`,
      }}
    >
      <span className={`pl-2 ${iconClassName}`}>Continue</span>
    </ActionButton>
  )
}

export default CommandBarHeader
