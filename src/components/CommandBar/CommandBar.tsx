import { Dialog, Popover, Transition } from '@headlessui/react'
import { CustomIcon } from 'components/CustomIcon'
import Tooltip from 'components/Tooltip'
import useHotkeyWrapper from 'lib/hotkeyWrapper'
import { commandBarActor, useCommandBarState } from 'machines/commandBarMachine'
import { Fragment, useEffect } from 'react'
import { useLocation } from 'react-router-dom'

import CommandComboBox from '../CommandComboBox'
import CommandBarArgument from './CommandBarArgument'
import CommandBarReview from './CommandBarReview'

export const COMMAND_PALETTE_HOTKEY = 'mod+k'

export const CommandBar = () => {
  const { pathname } = useLocation()
  const commandBarState = useCommandBarState()
  const {
    context: { selectedCommand, currentArgument, commands },
  } = commandBarState
  const isSelectionArgument =
    currentArgument?.inputType === 'selection' ||
    currentArgument?.inputType === 'selectionMixed'
  const WrapperComponent = isSelectionArgument ? Popover : Dialog

  // Close the command bar when navigating
  useEffect(() => {
    if (commandBarState.matches('Closed')) return
    commandBarActor.send({ type: 'Close' })
  }, [pathname])

  // Hook up keyboard shortcuts
  useHotkeyWrapper([COMMAND_PALETTE_HOTKEY], () => {
    if (commandBarState.context.commands.length === 0) return
    if (commandBarState.matches('Closed')) {
      commandBarActor.send({ type: 'Open' })
    } else {
      commandBarActor.send({ type: 'Close' })
    }
  })

  function stepBack() {
    if (!currentArgument) {
      if (commandBarState.matches('Review')) {
        const entries = Object.entries(selectedCommand?.args || {}).filter(
          ([_, argConfig]) =>
            !argConfig.hidden &&
            (typeof argConfig.required === 'function'
              ? argConfig.required(commandBarState.context)
              : argConfig.required)
        )

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
      const entries = Object.entries(selectedCommand?.args || {}).filter(
        (a) => !a[1].hidden
      )
      const index = entries.findIndex(
        ([key, _]) => key === currentArgument.name
      )

      if (index === 0) {
        commandBarActor.send({ type: 'Deselect command' })
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
        open={!commandBarState.matches('Closed') || isSelectionArgument}
        onClose={() => {
          commandBarActor.send({ type: 'Close' })
        }}
        className={
          'fixed inset-0 z-50 overflow-y-auto pb-4 pt-1 ' +
          (isSelectionArgument ? 'pointer-events-none' : '')
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
              <CommandComboBox options={commands} />
            ) : commandBarState.matches('Gathering arguments') ? (
              <CommandBarArgument stepBack={stepBack} />
            ) : (
              commandBarState.matches('Review') && (
                <CommandBarReview stepBack={stepBack} />
              )
            )}
            <div className="flex flex-col gap-2 !absolute left-auto right-full top-[-3px] m-2.5 p-0 border-none bg-transparent hover:bg-transparent">
              <button
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
              {!commandBarState.matches('Selecting command') && (
                <button onClick={stepBack} className="m-0 p-0 border-none">
                  <CustomIcon name="arrowLeft" className="w-5 h-5 rounded-sm" />
                  <Tooltip position="bottom">
                    Step back{' '}
                    <kbd className="hotkey ml-4 dark:!bg-chalkboard-80">
                      Shift
                    </kbd>
                    <kbd className="hotkey ml-4 dark:!bg-chalkboard-80">
                      Bksp
                    </kbd>
                  </Tooltip>
                </button>
              )}
            </div>
          </WrapperComponent.Panel>
        </Transition.Child>
      </WrapperComponent>
    </Transition.Root>
  )
}

export default CommandBar
