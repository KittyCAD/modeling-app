import { Dialog, Popover, Transition } from '@headlessui/react'
import { Fragment, useEffect } from 'react'
import { useLocation } from 'react-router-dom'

import CommandBarArgument from '@src/components/CommandBar/CommandBarArgument'
import CommandBarReview from '@src/components/CommandBar/CommandBarReview'
import CommandComboBox from '@src/components/CommandComboBox'
import { CustomIcon } from '@src/components/CustomIcon'
import Tooltip from '@src/components/Tooltip'
import { evaluateCommandBarArg } from '@src/components/CommandBar/utils'
import Loading from '@src/components/Loading'
import { commandBarActor, useCommandBarState } from '@src/lib/singletons'
import { COMMAND_PALETTE_HOTKEY } from '@src/lib/constants'
import { useShortcuts } from '@src/lib/useShortcuts'

const commandBarShortcuts = [
  {
    name: 'toggle-cmd-palette',
    sequence: COMMAND_PALETTE_HOTKEY,
    title: 'Toggle Command Palette',
    description: 'Toggle the command palette open and closed',
    category: 'Command Palette',
    action: () => {
      const s = commandBarActor.getSnapshot()
      console.log('what is the current state?', s.value)
      if (s.context.commands.length === 0) return
      if (s.matches('Closed')) {
        commandBarActor.send({ type: 'Open' })
      } else {
        commandBarActor.send({ type: 'Close' })
      }
    },
  },
]

export const CommandBar = () => {
  const { pathname } = useLocation()
  const commandBarState = useCommandBarState()
  const {
    context: { selectedCommand, currentArgument, commands },
  } = commandBarState

  // The command palette used to have light dismiss behavior, but we've decided
  // it's not a great fit for workflows where the user may want to review other
  // parts of the system while paused on a step. We'll leave this logic for now, but
  // TODO: consider removing this branching for light dismiss, or making it
  // configurable per-command (or per argument) if there are commands users expect to
  // be light-dismissable.
  const isArgumentThatShouldBeHardToDismiss = true
  const WrapperComponent = isArgumentThatShouldBeHardToDismiss
    ? Popover
    : Dialog

  // Close the command bar when navigating
  // but importantly not when the query parameters change
  useEffect(() => {
    if (commandBarState.matches('Closed')) return
    commandBarActor.send({ type: 'Close' })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
  }, [pathname])

  // Hook up keyboard shortcuts
  useShortcuts(commandBarShortcuts, [])

  function stepBack() {
    const entries = Object.entries(selectedCommand?.args || {}).filter(
      ([argName, arg]) => {
        const { value, isRequired, isHidden } = evaluateCommandBarArg(
          argName,
          arg,
          commandBarState.context
        )
        return !isHidden && (value || isRequired)
      }
    )

    if (!currentArgument) {
      if (commandBarState.matches('Review')) {
        const currentArgName = entries[entries.length - 1][0]
        const currentArg = {
          name: currentArgName,
          ...entries[entries.length - 1][1],
        }

        commandBarActor.send({
          type: 'Edit argument',
          data: {
            arg: currentArg,
          },
        })
      } else {
        commandBarActor.send({ type: 'Deselect command' })
      }
    } else {
      const index = entries.findIndex(
        ([key, _]) => key === currentArgument.name
      )

      if (index === 0) {
        // We're on the first entry, just close
        commandBarActor.send({ type: 'Close' })
      } else {
        commandBarActor.send({
          type: 'Change current argument',
          data: {
            arg: { name: entries[index - 1][0], ...entries[index - 1][1] },
          },
        })
      }
    }
  }

  return (
    <Transition.Root
      show={!commandBarState.matches('Closed') || false}
      afterLeave={() => {
        if (selectedCommand?.onCancel) selectedCommand.onCancel()
        commandBarActor.send({ type: 'Clear' })
      }}
      as={Fragment}
    >
      <WrapperComponent
        open={
          !commandBarState.matches('Closed') ||
          isArgumentThatShouldBeHardToDismiss
        }
        onClose={() => {
          commandBarActor.send({ type: 'Close' })
        }}
        className={
          'fixed inset-0 z-50 overflow-y-auto pb-4 pt-1 ' +
          (isArgumentThatShouldBeHardToDismiss ? 'pointer-events-none' : '')
        }
        data-testid="command-bar-wrapper"
      >
        <Transition.Child
          enter="duration-100 ease-out"
          enterFrom="opacity-0 scale-95"
          enterTo="opacity-100 scale-100"
          leave="duration-75 ease-in"
          leaveFrom="opacity-100 scale-100"
          leaveTo="opacity-0 scale-95"
        >
          <WrapperComponent.Panel
            className="relative z-50 pointer-events-auto w-full max-w-xl pt-2 mx-auto border rounded rounded-tl-none shadow-lg bg-chalkboard-10 dark:bg-chalkboard-100 dark:border-chalkboard-70"
            as="div"
            data-testid="command-bar"
          >
            {commandBarState.matches('Selecting command') ? (
              <CommandComboBox
                options={commands.filter((command) => {
                  return (
                    // By default everything is undefined
                    // If marked explicitly as false hide
                    command.hideFromSearch === undefined ||
                    command.hideFromSearch === false
                  )
                })}
              />
            ) : commandBarState.matches('Gathering arguments') ? (
              <CommandBarArgument stepBack={stepBack} />
            ) : (
              <>
                {commandBarState.matches('Review') && (
                  <CommandBarReview stepBack={stepBack} />
                )}
                {commandBarState.matches('Checking Arguments') && (
                  <div
                    className="py-4"
                    data-testid="command-bar-loading-checking-arguments"
                  >
                    <Loading isDummy={true}>Checking arguments...</Loading>
                  </div>
                )}
              </>
            )}
            <div className="flex flex-col gap-2 !absolute right-2 top-2 m-0 p-0 border-none bg-transparent hover:bg-transparent">
              <button
                data-testid="command-bar-close-button"
                onClick={() => commandBarActor.send({ type: 'Close' })}
                className="group m-0 p-0 border-none bg-transparent hover:bg-transparent"
              >
                <CustomIcon
                  name="close"
                  className="w-5 h-5 rounded-sm bg-destroy-10 text-destroy-80 dark:bg-destroy-80 dark:text-destroy-10 group-hover:brightness-110"
                />
                <Tooltip position="bottom">
                  Cancel{' '}
                  <kbd className="hotkey ml-4 dark:!bg-chalkboard-80">esc</kbd>
                </Tooltip>
              </button>
            </div>
          </WrapperComponent.Panel>
        </Transition.Child>
      </WrapperComponent>
    </Transition.Root>
  )
}
