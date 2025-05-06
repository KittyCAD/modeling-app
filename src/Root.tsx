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
import { billingActor, useToken } from '@src/lib/singletons'
import { BillingTransition } from '@src/machines/billingMachine'

// Root component will live for the entire applications runtime
// This is a great place to add polling code.
function RootLayout() {
  const apiToken = useToken()

  // Because credits can be spent outside the app, and they also take time to
  // calculate,  we have to poll to have an updated amount.
  // 5s should be reasonable. 2s for round trip network time and 3s for general
  // computation...
  setInterval(() => {
    billingActor.send({ type: BillingTransition.Update, apiToken })
  }, 5000)

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
