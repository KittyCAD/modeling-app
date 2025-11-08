import { Auth } from '@src/Auth'
import { AppStateProvider } from '@src/AppState'
import LspProvider from '@src/components/LspProvider'
import { MachineManagerProvider } from '@src/components/MachineManagerProvider'
import { OpenInDesktopAppHandler } from '@src/components/OpenInDesktopAppHandler'
import { SystemIOMachineLogicListenerDesktop } from '@src/components/Providers/SystemIOProviderDesktop'
import { SystemIOMachineLogicListenerWeb } from '@src/components/Providers/SystemIOProviderWeb'
import { RouteProvider } from '@src/components/RouteProvider'
import { KclContextProvider } from '@src/lang/KclProvider'
import { isDesktop } from '@src/lib/isDesktop'
import { ShortcutListener } from '@src/components/ShortcutListener'
import { Outlet } from 'react-router-dom'
import { MlEphantManagerReactContext } from '@src/machines/mlEphantManagerMachine2'
import { useToken } from '@src/lib/singletons'

// Root component will live for the entire applications runtime
// This is a great place to add polling code.
function RootLayout() {
  // Many providers need at the very least a Zoo API token to work.
  // We can provide that here.
  const apiToken = useToken()

  return (
    <OpenInDesktopAppHandler>
      <ShortcutListener>
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
            </MlEphantManagerReactContext.Provider>
          </Auth>
        </RouteProvider>
      </ShortcutListener>
    </OpenInDesktopAppHandler>
  )
}

export default RootLayout
