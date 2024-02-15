import { SettingsAuthStateContext } from 'components/SettingsAuthStateProvider'
import { useContext } from 'react'

export const useSettingsAuthContext = () => {
  return useContext(SettingsAuthStateContext)
}
