import { AppStateProvider } from '@src/AppState'
import { Auth } from '@src/Auth'
import { OpenInDesktopAppHandler } from '@src/components/OpenInDesktopAppHandler'
import { SystemIOMachineLogicListener } from '@src/components/SystemIOMachineLogicListener'
import { useApp } from '@src/lib/boot'
import { routerService } from '@src/registry/contracts/router'
import { RouterServiceSync } from '@src/registry/extensions/router/RouterServiceSync'
import { Outlet } from 'react-router-dom'
import { useAuthNavigation } from '@src/hooks/useAuthNavigation'
import { SessionExpiredDialogHost } from '@src/components/SessionExpiredDialog'

// Root component will live for the entire applications runtime
// This is a great place to add polling code.
function RootLayout() {
  const app = useApp()
  const router = app.registry.get(routerService)
  useAuthNavigation()

  return (
    <>
      <RouterServiceSync router={router} />
      <OpenInDesktopAppHandler>
        <Auth>
          <AppStateProvider>
            <SystemIOMachineLogicListener />
            <Outlet />
          </AppStateProvider>
        </Auth>
      </OpenInDesktopAppHandler>
      <SessionExpiredDialogHost />
    </>
  )
}

export default RootLayout
