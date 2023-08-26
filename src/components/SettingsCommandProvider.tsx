import {
  SETTINGS_PERSIST_KEY,
  settingsCommandBarMeta,
  settingsMachine,
} from '../lib/settingsMachine'
import { useMachine } from '@xstate/react'
import { CommandsContext } from './CommandBar'
import { createContext, useContext, useEffect, useRef } from 'react'
import useStateMachineCommands from '../hooks/useStateMachineCommands'
import { setThemeClass } from '../lib/theme'
import { ContextFrom, InterpreterFrom, Prop } from 'xstate'
import { toast } from 'react-hot-toast'

export const SettingsContext = createContext(
  {} as {
    send: Prop<InterpreterFrom<typeof settingsMachine>, 'send'>
  } & ContextFrom<typeof settingsMachine>
)

export default function SettingsCommandProvider({
  children,
}: React.PropsWithChildren) {
  const retrievedSettings = useRef(
    localStorage?.getItem(SETTINGS_PERSIST_KEY) || '{}'
  )
  const persistedSettings = Object.assign(
    settingsMachine.initialState.context,
    JSON.parse(retrievedSettings.current) as Partial<
      (typeof settingsMachine)['context']
    >
  )

  const [state, send] = useMachine(settingsMachine, {
    context: persistedSettings,
    actions: {
      toastSuccess: (context, event) => {
        const truncatedNewValue =
          'data' in event && event.data instanceof Object
            ? (context[Object.keys(event.data)[0] as keyof typeof context]
                .toString()
                .substring(0, 28) as any)
            : undefined
        toast.success(
          event.type +
            (truncatedNewValue
              ? ` to "${truncatedNewValue}${
                  truncatedNewValue.length === 28 ? '...' : ''
                }"`
              : '')
        )
      },
    },
  })
  const { commands } = useContext(CommandsContext)

  useStateMachineCommands({
    state,
    send,
    commands,
    owner: 'settings',
    commandBarMeta: settingsCommandBarMeta,
  })

  useEffect(() => setThemeClass(state.context.theme), [state.context.theme])

  return (
    <SettingsContext.Provider
      value={{
        send,
        ...state.context,
      }}
    >
      {children}
    </SettingsContext.Provider>
  )
}
