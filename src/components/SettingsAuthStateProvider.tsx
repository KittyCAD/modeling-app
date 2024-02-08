import { useMachine } from '@xstate/react'
import { useNavigate } from 'react-router-dom'
import { paths } from '../Router'
import { authMachine, TOKEN_PERSIST_KEY } from '../machines/authMachine'
import withBaseUrl from '../lib/withBaseURL'
import React, { createContext, useEffect, useRef } from 'react'
import useStateMachineCommands from '../hooks/useStateMachineCommands'
import { settingsMachine } from 'machines/settingsMachine'
import { SETTINGS_PERSIST_KEY, validateSettings } from 'lib/settings'
import { toast } from 'react-hot-toast'
import { setThemeClass, Themes } from 'lib/theme'
import {
  AnyStateMachine,
  ContextFrom,
  InterpreterFrom,
  Prop,
  StateFrom,
} from 'xstate'
import { isTauri } from 'lib/isTauri'
import { settingsCommandBarConfig } from 'lib/commandBarConfigs/settingsCommandConfig'
import { authCommandBarConfig } from 'lib/commandBarConfigs/authCommandConfig'
import { initializeProjectDirectory, readSettingsFile } from 'lib/tauriFS'

type MachineContext<T extends AnyStateMachine> = {
  state: StateFrom<T>
  context: ContextFrom<T>
  send: Prop<InterpreterFrom<T>, 'send'>
}

type SettingsAuthContext = {
  auth: MachineContext<typeof authMachine>
  settings: MachineContext<typeof settingsMachine>
}

export const SettingsAuthStateContext = createContext({} as SettingsAuthContext)

export const SettingsAuthStateProvider = ({
  children,
}: {
  children: React.ReactNode
}) => {
  const navigate = useNavigate()

  // Settings machine setup
  // Load settings from local storage
  // and validate them
  const retrievedSettings = useRef(
    validateSettings(
      JSON.parse(localStorage?.getItem(SETTINGS_PERSIST_KEY) || '{}')
    )
  )
  const persistedSettings = Object.assign(
    settingsMachine.initialState.context,
    retrievedSettings.current.settings
  )

  const [settingsState, settingsSend] = useMachine(settingsMachine, {
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

  // If the app is running in the Tauri context,
  // try to read the settings from a file
  // after doing some validation on them
  useEffect(() => {
    async function getFileBasedSettings() {
      if (isTauri()) {
        const newSettings = await readSettingsFile()

        if (newSettings) {
          if (newSettings.defaultDirectory) {
            const newDefaultDirectory = await initializeProjectDirectory(
              newSettings.defaultDirectory || ''
            )
            if (newDefaultDirectory.error !== null) {
              toast.error(newDefaultDirectory.error.message)
            }

            if (newDefaultDirectory.path !== null) {
              newSettings.defaultDirectory = newDefaultDirectory.path
            }
          }
          const { settings: validatedSettings, errors: validationErrors } =
            validateSettings(newSettings)

          retrievedSettings.current = Object.assign(
            retrievedSettings.current,
            validatedSettings
          )
          settingsSend({
            type: 'Set All Settings',
            data: newSettings,
          })

          return validationErrors
        }
      } else {
        // If the app is not running in the Tauri context,
        // just use the settings from local storage
        // after they've been validated to ensure they are correct.
        settingsSend({
          type: 'Set All Settings',
          data: retrievedSettings.current.settings,
        })
      }
      return []
    }

    // If there were validation errors either from local storage or from the file,
    // log them to the console and show a toast message to the user.
    void getFileBasedSettings().then((validationErrors: string[]) => {
      const combinedErrors = new Set([
        ...retrievedSettings.current.errors,
        ...validationErrors,
      ])

      if (combinedErrors.size > 0) {
        const errorMessage =
          'Error validating persisted settings: ' +
          Array.from(combinedErrors).join(', ') +
          '. Using defaults.'
        console.error(errorMessage)
        toast.error(errorMessage)
      }
    })
  }, [settingsSend])

  useStateMachineCommands({
    machineId: 'settings',
    state: settingsState,
    send: settingsSend,
    commandBarConfig: settingsCommandBarConfig,
  })

  // Listen for changes to the system theme and update the app theme accordingly
  // This is only done if the theme setting is set to 'system'.
  // It can't be done in XState (in an invoked callback, for example)
  // because there doesn't seem to be a good way to listen to
  // events outside of the machine that also depend on the machine's context
  useEffect(() => {
    const matcher = window.matchMedia('(prefers-color-scheme: dark)')
    const listener = (e: MediaQueryListEvent) => {
      if (settingsState.context.theme !== 'system') return
      setThemeClass(e.matches ? Themes.Dark : Themes.Light)
    }

    matcher.addEventListener('change', listener)
    return () => matcher.removeEventListener('change', listener)
  }, [settingsState.context])

  // Auth machine setup
  const [authState, authSend] = useMachine(authMachine, {
    actions: {
      goToSignInPage: () => {
        navigate(paths.SIGN_IN)

        void logout()
      },
      goToIndexPage: () => {
        if (window.location.pathname.includes(paths.SIGN_IN)) {
          navigate(paths.INDEX)
        }
      },
    },
  })

  useStateMachineCommands({
    machineId: 'auth',
    state: authState,
    send: authSend,
    commandBarConfig: authCommandBarConfig,
  })

  return (
    <SettingsAuthStateContext.Provider
      value={{
        auth: {
          state: authState,
          context: authState.context,
          send: authSend,
        },
        settings: {
          state: settingsState,
          context: settingsState.context,
          send: settingsSend,
        },
      }}
    >
      {children}
    </SettingsAuthStateContext.Provider>
  )
}

export default SettingsAuthStateProvider

export function logout() {
  localStorage.removeItem(TOKEN_PERSIST_KEY)
  return (
    !isTauri() &&
    fetch(withBaseUrl('/logout'), {
      method: 'POST',
      credentials: 'include',
    })
  )
}
