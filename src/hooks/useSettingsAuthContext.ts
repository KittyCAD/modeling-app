import { SettingsAuthContext } from 'components/SettingsAuthProvider'
import { useContext } from 'react'

export const useSettingsAuthContext = () => {
  return useContext(SettingsAuthContext)
}
