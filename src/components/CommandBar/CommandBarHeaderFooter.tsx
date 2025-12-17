import type React from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'

import { ActionButton } from '@src/components/ActionButton'
import CommandBarDivider from '@src/components/CommandBar/CommandBarDivider'
import { CustomIcon } from '@src/components/CustomIcon'
import Tooltip from '@src/components/Tooltip'
import type {
  KclCommandValue,
  KclExpressionWithVariable,
} from '@src/lib/commandTypes'
import type { Selections } from '@src/machines/modelingSharedTypes'
import { getSelectionTypeDisplayText } from '@src/lib/selections'
import {
  commandBarActor,
  kclManager,
  useCommandBarState,
} from '@src/lib/singletons'
import { roundOffWithUnits } from '@src/lib/utils'
import { evaluateCommandBarArg } from '@src/components/CommandBar/utils'

function CommandBarHeaderFooter({
  children,
  stepBack,
  clear,
  submitDisabled,
}: React.PropsWithChildren<object> & {
  stepBack: () => void
  clear?: () => void
  submitDisabled?: boolean
}) {
  const commandBarState = useCommandBarState()
  const {
    context: { selectedCommand, currentArgument, argumentsToSubmit },
  } = commandBarState
  const nonHiddenArgs = useMemo(() => {
    if (!selectedCommand?.args) return undefined
    const s = { ...selectedCommand.args }
    for (const [name, arg] of Object.entries(s)) {
      const { isHidden } = evaluateCommandBarArg(
        name,
        arg,
        commandBarState.context
      )
      if (isHidden) {
        delete s[name]
      }
    }
    return s
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
  }, [selectedCommand])
  const isReviewing = commandBarState.matches('Review')
  const [showShortcuts, setShowShortcuts] = useState(false)
  const isCurrentArgRequired =
    typeof currentArgument?.required === 'function'
      ? currentArgument.required(commandBarState.context)
      : currentArgument?.required

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
                <span
                  className={`text-xs rounded-full  ml-2 px-1 py-1 border ${selectedCommand.mlBranding ? 'border-ml-green dark:text-ml-green' : 'border-primary dark:text-primary'}`}
                >
                  <CustomIcon name="beaker" className="w-4 h-4" />
                  <Tooltip
                    position="bottom-right"
                    contentClassName="max-w-none flex items-center"
                  >
                    <span>Experimental</span>
                  </Tooltip>
                </span>
              ) : (
                <span className="pr-2" />
              )}
            </p>
            {Object.entries(nonHiddenArgs || {}).flatMap(
              ([argName, arg], i) => {
                const { value: argValue, isRequired } = evaluateCommandBarArg(
                  argName,
                  arg,
                  commandBarState.context
                )
                const isCurrentArg = argName === currentArgument?.name
                const isSkipFalse = arg.skip === false

                // We actually want to show non-hidden optional args that have a value set already
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
                        ? selectedCommand.mlBranding
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
                          getSelectionTypeDisplayText(
                            kclManager.astSignal.value,
                            argValue as Selections
                          )
                        ) : arg.inputType === 'kcl' ? (
                          roundOffWithUnits(
                            (argValue as KclCommandValue).valueCalculated,
                            4
                          )
                        ) : arg.inputType === 'vector3d' ? (
                          (argValue as KclCommandValue).valueCalculated
                        ) : arg.inputType === 'vector2d' ? (
                          (argValue as KclCommandValue).valueCalculated
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
        <CommandBarDivider />
        {children}
        <div className="px-4 pb-2 flex items-center gap-2">
          <StepBackButton stepBack={stepBack} />
          {!isCurrentArgRequired && clear && <ClearButton clear={clear} />}
          <div className="flex-grow"></div>
          {isReviewing ? (
            <ReviewingButton
              bgClassName={
                selectedCommand.mlBranding ? '!bg-ml-green' : '!bg-primary'
              }
              iconClassName={
                selectedCommand.mlBranding
                  ? '!text-ml-black'
                  : '!text-chalkboard-10'
              }
              disabled={submitDisabled}
            />
          ) : (
            <GatheringArgsButton
              bgClassName={
                selectedCommand.mlBranding ? '!bg-ml-green' : '!bg-primary'
              }
              iconClassName={
                selectedCommand.mlBranding
                  ? '!text-ml-black'
                  : '!text-chalkboard-10'
              }
            />
          )}
        </div>
      </>
    )
  )
}

type ButtonProps = {
  bgClassName?: string
  iconClassName?: string
  disabled?: boolean
}
function ReviewingButton({
  bgClassName,
  iconClassName,
  disabled,
}: ButtonProps) {
  const buttonRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (buttonRef.current) {
      buttonRef.current.focus()
    }
  }, [])
  const resolvedIconClassName = disabled ? '!text-3' : iconClassName
  const resolvedBgClassName = disabled ? '!bg-3' : bgClassName
  return (
    <ActionButton
      Element="button"
      ref={buttonRef}
      type="submit"
      form="review-form"
      className={`w-fit !p-0 rounded-sm hover:brightness-110 hover:shadow focus:outline-current ${resolvedBgClassName}`}
      tabIndex={0}
      data-testid="command-bar-submit"
      disabled={disabled}
      iconEnd={{
        icon: 'checkmark',
        bgClassName: `p-1 rounded-sm ${resolvedBgClassName}`,
        iconClassName: `${resolvedIconClassName}`,
      }}
    >
      <span className={`pl-2 ${resolvedIconClassName}`}>Submit</span>
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
        icon: 'arrowShortRight',
        bgClassName: `p-1 rounded-sm ${bgClassName}`,
        iconClassName: `${iconClassName}`,
      }}
    >
      <span className={`pl-2 ${iconClassName}`}>Continue</span>
    </ActionButton>
  )
}

function StepBackButton({
  bgClassName,
  iconClassName,
  stepBack,
}: ButtonProps & { stepBack: () => void }) {
  return (
    <ActionButton
      Element="button"
      type="button"
      form="arg-form"
      className={`w-fit !p-0 rounded-sm hover:brightness-110 hover:shadow focus:outline-current bg-chalkboard-20/50 dark:bg-chalkboard-80/50 border-chalkboard-20 dark:border-chalkboard-80 ${bgClassName}`}
      tabIndex={0}
      data-testid="command-bar-step-back"
      iconStart={{
        icon: 'arrowShortLeft',
        bgClassName: `p-1 rounded-sm bg-chalkboard-20/50 dark:bg-chalkboard-80/50 ${bgClassName}`,
        iconClassName: `${iconClassName}`,
      }}
      onClick={stepBack}
    >
      <span className={`pr-2 ${iconClassName}`}>Step back</span>
      <Tooltip position="bottom">
        Step back
        <kbd className="hotkey ml-4 dark:!bg-chalkboard-80">Shift</kbd>
        <kbd className="hotkey ml-2 dark:!bg-chalkboard-80">Bksp</kbd>
      </Tooltip>
    </ActionButton>
  )
}

function ClearButton({
  bgClassName,
  iconClassName,
  clear,
}: ButtonProps & { clear: () => void }) {
  return (
    <ActionButton
      Element="button"
      type="button"
      form="arg-form"
      className={`w-fit !p-0 rounded-sm hover:brightness-110 hover:shadow focus:outline-current bg-chalkboard-20/50 dark:bg-chalkboard-80/50 border-chalkboard-20 dark:border-chalkboard-80 ${bgClassName}`}
      tabIndex={0}
      data-testid="command-bar-clear-non-required-button"
      iconStart={{
        icon: 'trash',
        bgClassName: `p-1 rounded-sm bg-chalkboard-20/50 dark:bg-chalkboard-80/50 ${bgClassName}`,
        iconClassName: `${iconClassName}`,
      }}
      onClick={clear}
    >
      <span className={`pr-2 ${iconClassName}`}>Clear</span>
      <Tooltip position="bottom">Clear</Tooltip>
    </ActionButton>
  )
}

export default CommandBarHeaderFooter
