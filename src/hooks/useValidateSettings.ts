import { validateSettings } from 'lib/settings/settingsUtils'
import { useEffect } from 'react'
import toast from 'react-hot-toast'
import { useRouteLoaderData } from 'react-router-dom'
import { useSettingsAuthContext } from './useSettingsAuthContext'
import { paths } from 'lib/paths'

// This hook must only be used within a descendant of the SettingsAuthProvider component
// (and, by extension, the Router component).
// Specifically it relies on the Router's indexLoader data and the settingsMachine send function.
// for the settings and validation errors to be available.
export function useValidateSettings() {
  const {
    settings: { send },
  } = useSettingsAuthContext()
  const { settings, errors } = useRouteLoaderData(paths.INDEX) as Awaited<
    ReturnType<typeof validateSettings>
  >

  // If there were validation errors either from local storage or from the file,
  // log them to the console and show a toast message to the user.
  useEffect(() => {
    console.log({
      settings,
      errors,
    })
    if (errors.length > 0) {
      send('Set All Settings', settings)
      const errorMessage =
        'Error validating persisted settings: ' +
        errors.join(', ') +
        '. Using defaults.'
      console.error(errorMessage)
      toast.error(errorMessage)
    }
  }, [errors])
}
