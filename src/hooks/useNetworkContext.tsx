import { createContext, useContext } from 'react'

export const NetworkContext = createContext(null)
export const useNetworkContext = () => {
  return useContext(NetworkContext)
}
