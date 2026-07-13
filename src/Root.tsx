import { AppStateProvider } from '@src/AppState'
import { Auth } from '@src/Auth'
import LspProvider from '@src/components/LspProvider'
import { OpenInDesktopAppHandler } from '@src/components/OpenInDesktopAppHandler'
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
              <Outlet />
            </AppStateProvider>
          </LspProvider>
        </Auth>
      </RouteProvider>
    </OpenInDesktopAppHandler>
  )
}

export default RootLayout
