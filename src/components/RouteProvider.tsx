import { useSignals } from '@preact/signals-react/runtime'
import { SessionExpiredDialogHost } from '@src/components/SessionExpiredDialog'
import { useAuthNavigation } from '@src/hooks/useAuthNavigation'
import type { ReactNode } from 'react'
import { createContext } from 'react'

export const RouteProviderContext = createContext({})

export function RouteProvider({ children }: { children: ReactNode }) {
  useSignals()
  useAuthNavigation()

  return (
    <RouteProviderContext.Provider value={{}}>
      {children}
      <SessionExpiredDialogHost />
    </RouteProviderContext.Provider>
  )
}
