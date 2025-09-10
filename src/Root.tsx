import { withAPIBaseURL } from '@src/lib/withBaseURL'
import { AppStateProvider } from '@src/AppState'
import LspProvider from '@src/components/LspProvider'
import { MachineManagerProvider } from '@src/components/MachineManagerProvider'
import { OpenInDesktopAppHandler } from '@src/components/OpenInDesktopAppHandler'
import { SystemIOMachineLogicListenerDesktop } from '@src/components/Providers/SystemIOProviderDesktop'
import { SystemIOMachineLogicListenerWeb } from '@src/components/Providers/SystemIOProviderWeb'
import { RouteProvider } from '@src/components/RouteProvider'
import { KclContextProvider } from '@src/lang/KclProvider'
import { isDesktop } from '@src/lib/isDesktop'
import { Outlet } from 'react-router-dom'
import { MlEphantMachineContext } from '@src/machines/mlEphantManagerMachine2'
import { useToken } from '@src/lib/singletons'
import { ZooSocket } from '@src/lib/utils'

// Root component will live for the entire applications runtime
// This is a great place to add polling code.
function RootLayout() {
  // Many providers need at the very least a Zoo API token to work.
  // We can provide that here.
  const token = useToken()

  const wsCopilot = ZooSocket('/ws/ml/copilot', token)

  return (
    <OpenInDesktopAppHandler>
      <RouteProvider>
        {/* It's possible the ML agent will interact with the user
        on the project view or anywhere else in the app in the future. It should
        work regardless of the LSP or sketching being available, as users
        may simply want to ask it questions. */}
        <MlEphantMachineContext.Provider
          options={{
            input: {
              ws: wsCopilot,
            },
          }}
        >
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
        </MlEphantMachineContext.Provider>
      </RouteProvider>
    </OpenInDesktopAppHandler>
  )
}

export default RootLayout
