import { Auth } from '@src/Auth'
import { AppStateProvider } from '@src/AppState'
import LspProvider from '@src/components/LspProvider'
import { MachineManagerProvider } from '@src/components/MachineManagerProvider'
import { OpenInDesktopAppHandler } from '@src/components/OpenInDesktopAppHandler'
import { SystemIOMachineLogicListener } from '@src/components/SystemIOMachineLogicListener'
import { RouteProvider } from '@src/components/RouteProvider'
import { Outlet } from 'react-router-dom'
import { MlEphantManagerReactContext } from '@src/machines/mlEphantManagerMachine'
import { useSingletons } from '@src/lib/boot'

// Root component will live for the entire applications runtime
// This is a great place to add polling code.
function RootLayout() {
  const { useToken } = useSingletons()
  // Many providers need at the very least a Zoo API token to work.
  // We can provide that here.
  const apiToken = useToken()

  return (
    <OpenInDesktopAppHandler>
      <RouteProvider>
        <Auth>
          {/* It's possible the ML agent will interact with the user
        on the project view or anywhere else in the app in the future. It should
        work regardless of the LSP or sketching being available, as users
        may simply want to ask it questions. */}
          <MlEphantManagerReactContext.Provider
            options={{
              input: {
                apiToken,
              },
            }}
          >
            <LspProvider>
              <AppStateProvider>
                <MachineManagerProvider>
                  <SystemIOMachineLogicListener />
                  <Outlet />
                </MachineManagerProvider>
              </AppStateProvider>
            </LspProvider>
          </MlEphantManagerReactContext.Provider>
        </Auth>
      </RouteProvider>
    </OpenInDesktopAppHandler>
  )
}

export default RootLayout
