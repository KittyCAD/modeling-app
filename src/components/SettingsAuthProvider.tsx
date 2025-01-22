import { trap } from 'lib/trap'
import { useMachine, useSelector } from '@xstate/react'
import { useNavigate, useRouteLoaderData, useLocation } from 'react-router-dom'
import { PATHS, BROWSER_PATH } from 'lib/paths'
import React, { createContext, useEffect, useState } from 'react'
import { settingsMachine } from 'machines/settingsMachine'
import { toast } from 'react-hot-toast'
import {
  darkModeMatcher,
  getOppositeTheme,
  setThemeClass,
  Themes,
} from 'lib/theme'
import decamelize from 'decamelize'
import { Actor, AnyStateMachine, ContextFrom, Prop, StateFrom } from 'xstate'
import {
  kclManager,
  sceneInfra,
  engineCommandManager,
  sceneEntitiesManager,
} from 'lib/singletons'
import { IndexLoaderData } from 'lib/types'
import { createSettings, settings } from 'lib/settings/initialSettings'
import {
  createSettingsCommand,
  settingsWithCommandConfigs,
} from 'lib/commandBarConfigs/settingsCommandConfig'
import { Command } from 'lib/commandTypes'
import { BaseUnit } from 'lib/settings/settingsTypes'
import {
  saveSettings,
  loadAndValidateSettings,
} from 'lib/settings/settingsUtils'
import { reportRejection } from 'lib/trap'
import { getAppSettingsFilePath } from 'lib/desktop'
import { isDesktop } from 'lib/isDesktop'
import { useFileSystemWatcher } from 'hooks/useFileSystemWatcher'
import { codeManager } from 'lib/singletons'
import { createRouteCommands } from 'lib/commandBarConfigs/routeCommandConfig'
import { commandBarActor } from 'machines/commandBarMachine'

type MachineContext<T extends AnyStateMachine> = {
  state: StateFrom<T>
  context: ContextFrom<T>
  send: Prop<Actor<T>, 'send'>
}

type SettingsAuthContextType = {
  settings: MachineContext<typeof settingsMachine>
}

/**
 * This variable is used to store the last snapshot of the settings context
 * for use outside of React, such as in `wasm.ts`. It is updated every time
 * the settings machine changes with `useSelector`.
 * TODO: when we decouple XState from React, we can just subscribe to the actor directly from `wasm.ts`
 */
export let lastSettingsContextSnapshot:
  | ContextFrom<typeof settingsMachine>
  | undefined

export const SettingsAuthContext = createContext({} as SettingsAuthContextType)

export const SettingsAuthProvider = ({
  children,
}: {
  children: React.ReactNode
}) => {
  const loadedSettings = createSettings()
  const loadedProject = useRouteLoaderData(PATHS.FILE) as IndexLoaderData
  return (
    <SettingsAuthProviderBase
      loadedSettings={loadedSettings}
      loadedProject={loadedProject}
    >
      {children}
    </SettingsAuthProviderBase>
  )
}

// For use in jest tests we don't want to use the loader data
// and mock the whole Router
export const SettingsAuthProviderJest = ({
  children,
}: {
  children: React.ReactNode
}) => {
  const loadedSettings = settings
  return (
    <SettingsAuthProviderBase loadedSettings={loadedSettings}>
      {children}
    </SettingsAuthProviderBase>
  )
}

export const SettingsAuthProviderBase = ({
  children,
  loadedSettings,
}: {
  children: React.ReactNode
  loadedSettings: typeof settings
  loadedProject?: IndexLoaderData
}) => {
  const [settingsState, settingsSend, settingsActor] = useMachine(
    settingsMachine,
    { input: loadedSettings }
  )

  return (
    <SettingsAuthContext.Provider
      value={{
        settings: {
          state: settingsState,
          context: settingsState.context,
          send: settingsSend,
        },
      }}
    >
      {children}
    </SettingsAuthContext.Provider>
  )
}

export default SettingsAuthProvider
