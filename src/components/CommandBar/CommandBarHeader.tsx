import { useCommandsContext } from 'hooks/useCommandsContext'
import { CustomIcon } from '../CustomIcon'
import React, { ReactNode, useState } from 'react'
import { ActionButton } from '../ActionButton'
import { Selections, getSelectionTypeDisplayText } from 'lib/selections'
import { useHotkeys } from 'react-hotkeys-hook'
import { KclCommandValue, KclExpressionWithVariable } from 'lib/commandTypes'
import Tooltip from 'components/Tooltip'

function CommandBarHeader({ children }: React.PropsWithChildren<{}>) {
  const { commandBarState, commandBarSend } = useCommandsContext()
  const {
    context: { selectedCommand, currentArgument, argumentsToSubmit },
  } = commandBarState
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
        if (!selectedCommand?.args) return
        const argName = Object.keys(selectedCommand.args)[
          parseInt(b.keys[0], 10) - 1
        ]
        const arg = selectedCommand?.args[argName]
        commandBarSend({
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
              className="pr-4 flex gap-2 items-center"
            >
              {selectedCommand &&
                'icon' in selectedCommand &&
                selectedCommand.icon && (
                  <CustomIcon name={selectedCommand.icon} className="w-5 h-5" />
                )}
              {selectedCommand?.name}
            </p>
            {Object.entries(selectedCommand?.args || {}).map(
              ([argName, arg], i) => (
                <button
                  disabled={!isReviewing && currentArgument?.name === argName}
                  onClick={() => {
                    commandBarSend({
                      type: isReviewing
                        ? 'Edit argument'
                        : 'Change current argument',
                      data: { arg: { ...arg, name: argName } },
                    })
                  }}
                  key={argName}
                  className={`relative w-fit px-2 py-1 rounded-sm flex gap-2 items-center border ${
                    argName === currentArgument?.name
                      ? 'disabled:bg-energy-10/50 dark:disabled:bg-energy-10/20 disabled:border-energy-10 dark:disabled:border-energy-10 disabled:text-chalkboard-100 dark:disabled:text-chalkboard-10'
                      : 'bg-chalkboard-20/50 dark:bg-chalkboard-80/50 border-chalkboard-20 dark:border-chalkboard-80'
                  }`}
                >
                  <span className="capitalize">{argName}</span>
                  {argumentsToSubmit[argName] ? (
                    arg.inputType === 'selection' ? (
                      getSelectionTypeDisplayText(
                        argumentsToSubmit[argName] as Selections
                      )
                    ) : arg.inputType === 'kcl' ? (
                      (argumentsToSubmit[argName] as KclCommandValue)
                        .valueCalculated
                    ) : typeof argumentsToSubmit[argName] === 'object' ? (
                      JSON.stringify(argumentsToSubmit[argName])
                    ) : (
                      <em>{argumentsToSubmit[argName] as ReactNode}</em>
                    )
                  ) : null}
                  {showShortcuts && (
                    <small className="absolute -top-[1px] right-full translate-x-1/2 px-0.5 rounded-sm bg-chalkboard-80 text-chalkboard-10 dark:bg-energy-10 dark:text-chalkboard-100">
                      <span className="sr-only">Hotkey: </span>
                      {i + 1}
                    </small>
                  )}
                  {arg.inputType === 'kcl' &&
                    !!argumentsToSubmit[argName] &&
                    'variableName' in
                      (argumentsToSubmit[argName] as KclCommandValue) && (
                      <>
                        <CustomIcon name="make-variable" className="w-4 h-4" />
                        <Tooltip position="blockEnd">
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
            )}
          </div>
          {isReviewing ? <ReviewingButton /> : <GatheringArgsButton />}
        </div>
        <div className="block w-full my-2 h-[1px] bg-chalkboard-20 dark:bg-chalkboard-80" />
        {children}
      </>
    )
  )
}

function ReviewingButton() {
  return (
    <ActionButton
      Element="button"
      autoFocus
      type="submit"
      form="review-form"
      className="w-fit !p-0 rounded-sm border !border-chalkboard-100 dark:!border-energy-10 hover:shadow"
      icon={{
        icon: 'checkmark',
        bgClassName:
          'p-1 rounded-sm !bg-chalkboard-100 hover:!bg-chalkboard-110 dark:!bg-energy-20 dark:hover:!bg-energy-10',
        iconClassName: '!text-energy-10 dark:!text-chalkboard-100',
      }}
    >
      <span className="sr-only">Submit command</span>
    </ActionButton>
  )
}

function GatheringArgsButton() {
  return (
    <ActionButton
      Element="button"
      type="submit"
      form="arg-form"
      className="w-fit !p-0 rounded-sm"
      icon={{
        icon: 'arrowRight',
        bgClassName: 'p-1 rounded-sm',
      }}
    >
      <span className="sr-only">Continue</span>
    </ActionButton>
  )
}

export default CommandBarHeader
