import { Dialog, Popover, Transition } from '@headlessui/react'
import { Fragment, useEffect } from 'react'
import { useLocation } from 'react-router-dom'

import CommandBarArgument from '@src/components/CommandBar/CommandBarArgument'
import CommandBarReview from '@src/components/CommandBar/CommandBarReview'
import { evaluateCommandBarArg } from '@src/components/CommandBar/utils'
import CommandComboBox from '@src/components/CommandComboBox'
import { CustomIcon } from '@src/components/CustomIcon'
import Loading from '@src/components/Loading'
import ModelingDialog from '@src/components/ModelingDialog/ModelingDialog'
import Tooltip from '@src/components/Tooltip'
import { useApp } from '@src/lib/boot'
import type { Command, CommandArgument } from '@src/lib/commandTypes'
import useHotkeyWrapper from '@src/lib/hotkeyWrapper'
import { keymapService } from '@src/registry/contracts/keymap'

export const COMMAND_PALETTE_HOTKEY = 'mod+k'

export const CommandBar = () => {
  const { pathname } = useLocation()
  const { commands: cmd, project, registry } = useApp()
  const keymap = registry.optional(keymapService)
  const commandBarState = cmd.useState()
  const isCommandBarOpen = !commandBarState.matches('Closed')
  const {
    context: { selectedCommand, currentArgument, commands },
  } = commandBarState
  const isModelingDialogCommand =
    selectedCommand?.groupId === 'modeling' &&
    selectedCommand.useModelingDialog === true

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
  // biome-ignore lint/correctness/useExhaustiveDependencies: this intentionally reacts only to path changes.
  useEffect(() => {
    if (commandBarState.matches('Closed')) {
      return
    }
    cmd.send({ type: 'Close' })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
  }, [pathname])

  useEffect(() => {
    if (!keymap || !isCommandBarOpen) {
      return
    }

    keymap.applyScope('cmd-palette-open')

    return () => {
      keymap.removeScope('cmd-palette-open')
    }
  }, [isCommandBarOpen, keymap])

  // Hook up keyboard shortcuts
  useHotkeyWrapper(
    ['esc'],
    () => cmd.send({ type: 'Close' }),
    project?.executingEditor.value ?? undefined,
    {
      enableOnFormTags: true,
      enableOnContentEditable: true,
    }
  )

  function stepBack() {
    const entries = (
      Object.entries(selectedCommand?.args || {}) as [
        string,
        CommandArgument<unknown>,
      ][]
    ).filter(([argName, arg]) => {
      const { value, isRequired, isHidden } = evaluateCommandBarArg(
        argName,
        arg,
        commandBarState.context
      )
      return !isHidden && (value !== undefined || isRequired)
    })

    if (!currentArgument) {
      if (commandBarState.matches('Review')) {
        const currentArgName = entries[entries.length - 1][0]
        const currentArg = {
          name: currentArgName,
          ...entries[entries.length - 1][1],
        }

        cmd.send({
          type: 'Edit argument',
          data: {
            arg: currentArg,
          },
        })
      } else {
        cmd.send({ type: 'Deselect command' })
      }
    } else {
      const index = entries.findIndex(
        ([key, _]) => key === currentArgument.name
      )

      if (index === 0) {
        // We're on the first entry, just close
        cmd.send({ type: 'Close' })
      } else {
        // Either go to the previous argument if we could locate the current one,
        // or to the last one (likely a case of unconfirmed optional arg)
        const prevIndex = index === -1 ? entries.length - 1 : index - 1
        cmd.send({
          type: 'Change current argument',
          data: {
            arg: { name: entries[prevIndex][0], ...entries[prevIndex][1] },
          },
        })
      }
    }
  }

  return (
    <Transition.Root
      show={isCommandBarOpen || false}
      afterLeave={() => {
        if (selectedCommand?.onCancel) {
          selectedCommand.onCancel()
        }
        cmd.send({ type: 'Clear' })
      }}
      as={Fragment}
    >
      <WrapperComponent
        open={isCommandBarOpen || isArgumentThatShouldBeHardToDismiss}
        onClose={() => {
          cmd.send({ type: 'Close' })
        }}
        className={`fixed inset-0 z-50 overflow-y-auto pb-4 pt-1 ${isArgumentThatShouldBeHardToDismiss ? 'pointer-events-none' : ''}`}
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
            className={
              isModelingDialogCommand
                ? 'relative z-50 pointer-events-none w-full pt-2 mx-auto bg-transparent border-none shadow-none max-w-none'
                : 'relative z-50 pointer-events-auto w-full max-w-xl pt-2 mx-auto border rounded rounded-tl-none shadow-lg bg-chalkboard-10 dark:bg-chalkboard-100 dark:border-chalkboard-70'
            }
            as="div"
            data-testid="command-bar"
          >
            {commandBarState.matches('Selecting command') ? (
              <CommandComboBox
                options={commands.filter((command: Command) => {
                  return (
                    // By default everything is undefined
                    // If marked explicitly as false hide
                    command.hideFromSearch === undefined ||
                    command.hideFromSearch === false
                  )
                })}
              />
            ) : isModelingDialogCommand ? (
              <ModelingDialog />
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
            {!isModelingDialogCommand && (
              <div className="flex flex-col gap-2 !absolute right-2 top-2 m-0 p-0 border-none bg-transparent hover:bg-transparent">
                <button
                  type="button"
                  data-testid="command-bar-close-button"
                  onClick={() => cmd.send({ type: 'Close' })}
                  className="group m-0 p-0 border-none bg-transparent hover:bg-transparent"
                >
                  <CustomIcon
                    name="close"
                    className="w-5 h-5 rounded-sm bg-destroy-10 text-destroy-80 dark:bg-destroy-80 dark:text-destroy-10 group-hover:brightness-110"
                  />
                  <Tooltip position="bottom">
                    Cancel{' '}
                    <kbd className="hotkey ml-4 dark:!bg-chalkboard-80">
                      esc
                    </kbd>
                  </Tooltip>
                </button>
              </div>
            )}
          </WrapperComponent.Panel>
        </Transition.Child>
      </WrapperComponent>
    </Transition.Root>
  )
}
