import { Auth } from '@src/Auth'
import { AppStateProvider } from '@src/AppState'
import LspProvider from '@src/components/LspProvider'
import { OpenInDesktopAppHandler } from '@src/components/OpenInDesktopAppHandler'
import { SystemIOMachineLogicListener } from '@src/components/SystemIOMachineLogicListener'
import { RouteProvider } from '@src/components/RouteProvider'
import { Outlet } from 'react-router-dom'

// Root component will live for the entire applications runtime
// This is a great place to add polling code.
function RootLayout() {
  return (
    <OpenInDesktopAppHandler>
      <RouteProvider>
        <Auth>
          <LspProvider>
            <AppStateProvider>
              <SystemIOMachineLogicListener />
              <Outlet />
            </AppStateProvider>
          </LspProvider>
        </Auth>
      </RouteProvider>
    </OpenInDesktopAppHandler>
  )
}

export default RootLayout
