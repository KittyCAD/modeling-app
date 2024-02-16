import { GlobalStateContext } from 'components/GlobalStateProvider'
import { useContext } from 'react'

export const useGlobalStateContext = () => {
  return useContext(GlobalStateContext)
}
