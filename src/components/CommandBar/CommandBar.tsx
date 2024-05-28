import { Dialog, Popover, Transition } from '@headlessui/react'
import { Fragment, useEffect, useMemo } from 'react'
import { useCommandsContext } from 'hooks/useCommandsContext'
import CommandBarArgument from './CommandBarArgument'
import CommandComboBox from '../CommandComboBox'
import CommandBarReview from './CommandBarReview'
import { useLocation } from 'react-router-dom'
import { useInteractionMap } from 'hooks/useInteractionMap'
import { KEYBINDING_CATEGORIES } from 'lib/constants'

export const CommandBar = () => {
  const { pathname } = useLocation()
  const { commandBarState, commandBarSend } = useCommandsContext()
  const {
    context: { selectedCommand, currentArgument, commands },
  } = commandBarState
  const isSelectionArgument = currentArgument?.inputType === 'selection'
  const WrapperComponent = isSelectionArgument ? Popover : Dialog

  // Close the command bar when navigating
  useEffect(() => {
    commandBarSend({ type: 'Close' })
  }, [pathname])

  useInteractionMap(
    [
      {
        name: 'toggle',
        title: 'Toggle Command Bar',
        sequence: 'meta+k g RightButton+shift',
        action: () => {
          const type = commandBarState.matches('Closed') ? 'Open' : 'Close'
          console.log('toggling command bar', type)
          commandBarSend({
            type,
          })
        },
        guard: () => true,
      },
      {
        name: 'close',
        title: 'Close Command Bar',
        sequence: 'esc',
        action: () => {
          commandBarSend({ type: 'Close' })
        },
        guard: () => !commandBarState.matches('Closed'),
      },
    ],
    [commandBarState, commandBarSend],
    KEYBINDING_CATEGORIES.COMMAND_BAR
  )

  function stepBack() {
    if (!currentArgument) {
      if (commandBarState.matches('Review')) {
        const entries = Object.entries(selectedCommand?.args || {}).filter(
          ([_, argConfig]) =>
            typeof argConfig.required === 'function'
              ? argConfig.required(commandBarState.context)
              : argConfig.required
        )

        const currentArgName = entries[entries.length - 1][0]
        const currentArg = {
          name: currentArgName,
          ...entries[entries.length - 1][1],
        }

        commandBarSend({
          type: 'Edit argument',
          data: {
            arg: currentArg,
          },
        })
      } else {
        commandBarSend({ type: 'Deselect command' })
      }
    } else {
      const entries = Object.entries(selectedCommand?.args || {})
      const index = entries.findIndex(
        ([key, _]) => key === currentArgument.name
      )

      if (index === 0) {
        commandBarSend({ type: 'Deselect command' })
      } else {
        commandBarSend({
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
        commandBarSend({ type: 'Clear' })
      }}
      as={Fragment}
    >
      <WrapperComponent
        open={!commandBarState.matches('Closed') || isSelectionArgument}
        onClose={() => {
          commandBarSend({ type: 'Close' })
        }}
        className={
          'fixed inset-0 z-50 overflow-y-auto pb-4 pt-1 ' +
          (isSelectionArgument ? 'pointer-events-none' : '')
        }
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
            className="relative z-50 pointer-events-auto w-full max-w-xl py-2 mx-auto border rounded shadow-lg bg-chalkboard-10 dark:bg-chalkboard-100 dark:border-chalkboard-70"
            as="div"
            data-testid="command-bar"
          >
            {commandBarState.matches('Selecting command') ? (
              <CommandComboBox options={commands} />
            ) : commandBarState.matches('Gathering arguments') ? (
              <CommandBarArgument stepBack={stepBack} />
            ) : (
              commandBarState.matches('Review') && (
                <CommandBarReview stepBack={stepBack} />
              )
            )}
          </WrapperComponent.Panel>
        </Transition.Child>
      </WrapperComponent>
    </Transition.Root>
  )
}

export default CommandBar
