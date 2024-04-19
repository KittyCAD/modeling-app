import { useMachine } from '@xstate/react'
import { editorManager } from 'lib/singletons'
import { commandBarMachine } from 'machines/commandBarMachine'
import { createContext, useEffect } from 'react'
import { EventFrom, StateFrom } from 'xstate'

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
    devTools: true,
    guards: {
      'Command has no arguments': (context, _event) => {
        return (
          !context.selectedCommand?.args ||
          Object.keys(context.selectedCommand?.args).length === 0
        )
      },
    },
  })

  useEffect(() => {
    editorManager.setCommandBarSend(commandBarSend)
  })

  return (
    <CommandsContext.Provider
      value={{
        commandBarState,
        commandBarSend,
      }}
    >
      {children}
    </CommandsContext.Provider>
  )
}
