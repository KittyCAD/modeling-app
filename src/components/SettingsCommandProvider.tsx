import {
  SETTINGS_PERSIST_KEY,
  settingsCommandBarMeta,
  settingsMachine,
} from '../lib/settingsMachine'
import { useMachine } from '@xstate/react'
import { CommandsContext } from './CommandBar'
import { useContext, useEffect, useRef } from 'react'
import useStateMachineCommands from '../hooks/useStateMachineCommands'
import { setThemeClass } from '../lib/theme'

export default function SettingsCommandProvider({
  children,
}: React.PropsWithChildren) {
  const retrievedSettings = useRef(localStorage?.getItem(SETTINGS_PERSIST_KEY))
  const persistedSettings = retrievedSettings.current
    ? JSON.parse(retrievedSettings.current)
    : settingsMachine.initialState.context

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

  return <>{children}</>
}
