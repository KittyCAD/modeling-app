import { useCommandsContext } from 'hooks/useCommandsContext'
import { CustomIcon } from './CustomIcon'
import React from 'react'
import { ActionButton } from './ActionButton'

function CommandBarHeader({ children }: React.PropsWithChildren<{}>) {
  const { commandBarState, commandBarSend } = useCommandsContext()
  const {
    context: { selectedCommand, currentArgument, argumentsToSubmit },
  } = commandBarState
  const isReviewing = commandBarState.matches('Review')

  return (
    selectedCommand &&
    argumentsToSubmit && (
      <>
        <div className="px-4 text-sm flex gap-4 items-start">
          <div className="flex flex-1 flex-wrap gap-2">
            <p className="pr-4 flex gap-2 items-center">
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
                  onClick={() =>
                    commandBarSend({
                      type: 'Edit argument',
                      data: { arg: { ...arg, name: argName } },
                    })
                  }
                  key={argName}
                  className={`w-fit px-2 py-1 rounded-sm flex gap-2 items-center border ${
                    argName === currentArgument?.name
                      ? 'bg-energy-10/50 dark:bg-energy-10/20 border-energy-10 dark:border-energy-10'
                      : 'bg-chalkboard-20/50 dark:bg-chalkboard-80/50 border-chalkboard-20 dark:border-chalkboard-80'
                  }`}
                >
                  {argumentsToSubmit[argName] ? (
                    typeof argumentsToSubmit[argName] === 'object' ? (
                      JSON.stringify(argumentsToSubmit[argName])
                    ) : (
                      argumentsToSubmit[argName]
                    )
                  ) : arg.payload ? (
                    typeof arg.payload === 'object' ? (
                      JSON.stringify(arg.payload)
                    ) : (
                      arg.payload
                    )
                  ) : (
                    <em>{argName}</em>
                  )}
                </button>
              )
            )}
          </div>
          <ActionButton
            Element="button"
            onClick={() => {
              if (isReviewing) {
                commandBarSend({
                  type: 'Submit command',
                  data: argumentsToSubmit,
                })
              }
            }}
            className="w-fit !p-0 rounded-sm"
            icon={{
              icon: isReviewing ? 'checkmark' : 'arrowRight',
              bgClassName: `px-1 rounded-sm ${
                isReviewing ? '!bg-chalkboard-100 dark:bg-chalkboard-10' : ''
              }`,
              iconClassName: isReviewing
                ? 'text-chalkboard-10 dark:text-chalkboard-100'
                : '',
            }}
          />
        </div>
        <div className="block w-full my-2 h-[1px] bg-chalkboard-20 dark:bg-chalkboard-80" />
        {children}
      </>
    )
  )
}

export default CommandBarHeader
