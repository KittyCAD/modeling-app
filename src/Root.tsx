import { AppStateProvider } from '@src/AppState'
import LspProvider from '@src/components/LspProvider'
import { MachineManagerProvider } from '@src/components/MachineManagerProvider'
import { OpenInDesktopAppHandler } from '@src/components/OpenInDesktopAppHandler'
import { SystemIOMachineLogicListenerDesktop } from '@src/components/Providers/SystemIOProviderDesktop'
import { SystemIOMachineLogicListenerWeb } from '@src/components/Providers/SystemIOProviderWeb'
import { RouteProvider } from '@src/components/RouteProvider'
import { KclContextProvider } from '@src/lang/KclProvider'
import { Outlet } from 'react-router-dom'
import { isDesktop } from '@src/lib/isDesktop'

// Root component will live for the entire applications runtime
// This is a great place to add polling code.
function RootLayout() {
  return (
    <OpenInDesktopAppHandler>
      <RouteProvider>
        <LspProvider>
          <KclContextProvider>
            <AppStateProvider>
              <MachineManagerProvider>
                {isDesktop() ? (
                  <SystemIOMachineLogicListenerDesktop />
                ) : (
                  <SystemIOMachineLogicListenerWeb />
                )}
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
