import { Dialog, Popover, Transition } from '@headlessui/react'
import { Fragment, createContext, useEffect } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { useCommandsContext } from 'hooks/useCommandsContext'
import { useMachine } from '@xstate/react'
import { commandBarMachine } from 'machines/commandBarMachine'
import { EventFrom, StateFrom } from 'xstate'
import CommandBarArgument from './CommandBarArgument'
import CommandComboBox from './CommandComboBox'
import CommandBarHeader from './CommandBarHeader'

type CommandsContextType = {
  commandBarState: StateFrom<typeof commandBarMachine>
  commandBarSend: (event: EventFrom<typeof commandBarMachine>) => void
}

export const CommandsContext = createContext<CommandsContextType>({
  commandBarState: commandBarMachine.initialState,
  commandBarSend: () => {},
})

export const CommandBarProvider = ({
  children,
}: {
  children: React.ReactNode
}) => {
  const [commandBarState, commandBarSend] = useMachine(commandBarMachine, {
    guards: {
      'Arguments are ready': (context, _) => {
        return context.selectedCommand?.args
          ? context.argumentsToSubmit.length ===
              Object.keys(context.selectedCommand.args)?.length
          : false
      },
      'Command has no arguments': (
        _,
        event: EventFrom<typeof commandBarMachine>
      ) => {
        if (event.type !== 'Select command') return false
        return (
          !event.data.command.args ||
          Object.keys(event.data.command.args).length === 0
        )
      },
    },
  })

  return (
    <CommandsContext.Provider
      value={{
        commandBarState,
        commandBarSend,
      }}
    >
      {children}
      <CommandBar />
    </CommandsContext.Provider>
  )
}

const CommandBar = () => {
  const { commandBarState, commandBarSend } = useCommandsContext()
  const {
    context: { selectedCommand, currentArgument, commands },
  } = commandBarState
  const isSelectionArgument = currentArgument?.inputType === 'selection'
  const WrapperComponent = isSelectionArgument ? Popover : Dialog

  useEffect(() => console.log(commandBarState.value), [commandBarState.value])

  useHotkeys(['mod+k', 'mod+/'], () => {
    if (commandBarState.context.commands.length === 0) return
    if (commandBarState.matches('Closed')) {
      commandBarSend({ type: 'Open' })
    } else {
      commandBarSend({ type: 'Close' })
    }
  })

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
          'fixed inset-0 z-40 overflow-y-auto pb-4 pt-1 ' +
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
            className="relative w-full max-w-xl py-2 mx-auto border rounded shadow-lg bg-chalkboard-10 dark:bg-chalkboard-100 dark:border-chalkboard-70"
            as="div"
          >
            {commandBarState.matches('Selecting command') ? (
              <CommandComboBox options={commands} />
            ) : commandBarState.matches('Gathering arguments') ? (
              <CommandBarArgument />
            ) : commandBarState.matches('Review') ? (
              <CommandBarHeader>
                <p className="px-4 py-2">Confirm action</p>
              </CommandBarHeader>
            ) : (
              <p>{JSON.stringify(commandBarState.value, null, 2)}</p>
            )}
          </WrapperComponent.Panel>
        </Transition.Child>
      </WrapperComponent>
    </Transition.Root>
  )
}

export default CommandBarProvider
