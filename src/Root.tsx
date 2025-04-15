import { AppStateProvider } from '@src/AppState'
import LspProvider from '@src/components/LspProvider'
import { MachineManagerProvider } from '@src/components/MachineManagerProvider'
import { OpenInDesktopAppHandler } from '@src/components/OpenInDesktopAppHandler'
import { SystemIOMachineLogicListener } from '@src/components/Providers/SystemIOProviderDesktop'
import { RouteProvider } from '@src/components/RouteProvider'
import { KclContextProvider } from '@src/lang/KclProvider'
import { useEffect } from 'react'
import { Outlet } from 'react-router-dom'
function RootLayout() {
  useEffect(() => {
    console.log('MyComponent mounted')

    return () => {
      console.log('MyComponent unmounted')
    }
  }, [])
  return (
    <OpenInDesktopAppHandler>
      <RouteProvider>
        <LspProvider>
          <KclContextProvider>
            <AppStateProvider>
              <MachineManagerProvider>
                <SystemIOMachineLogicListener />
                <Outlet />
              </MachineManagerProvider>
            </AppStateProvider>
          </KclContextProvider>
        </LspProvider>
      </RouteProvider>
    </OpenInDesktopAppHandler>
  )
}

export default RootLayout
