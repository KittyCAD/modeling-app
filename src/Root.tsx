import { AppStateProvider } from '@src/AppState'
import LspProvider from '@src/components/LspProvider'
import { MachineManagerProvider } from '@src/components/MachineManagerProvider'
import { OpenInDesktopAppHandler } from '@src/components/OpenInDesktopAppHandler'
import { SystemIOMachineLogicListenerDesktop } from '@src/components/Providers/SystemIOProviderDesktop'
import { SystemIOMachineLogicListenerWeb } from '@src/components/Providers/SystemIOProviderWeb'
import { RouteProvider } from '@src/components/RouteProvider'
import { KclContextProvider } from '@src/lang/KclProvider'
import { isDesktop } from '@src/lib/isDesktop'
import { InteractionListener } from '@src/components/InteractionListener'
import { Outlet } from 'react-router-dom'

// Root component will live for the entire applications runtime
// This is a great place to add polling code.
function RootLayout() {
  return (
    <OpenInDesktopAppHandler>
      <InteractionListener>
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
      </InteractionListener>
    </OpenInDesktopAppHandler>
  )
}

export default RootLayout
