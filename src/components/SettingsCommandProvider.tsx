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
import { ContextFrom, EventData, EventFrom, SingleOrArray, State } from 'xstate'

export const SettingsContext = createContext(
  {} as {
    send: (
      event:
        | EventFrom<typeof settingsMachine>
        | SingleOrArray<typeof settingsMachine>,
      payload?: EventData | undefined
    ) => State<typeof settingsMachine>
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
