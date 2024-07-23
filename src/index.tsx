import ReactDOM from 'react-dom/client'
import './index.css'
import reportWebVitals from './reportWebVitals'
import { Toaster } from 'react-hot-toast'
import { Router } from './Router'
import { HotkeysProvider } from 'react-hotkeys-hook'
import ModalContainer from 'react-modal-promise'
import { UpdaterModal, createUpdaterModal } from 'components/UpdaterModal'
import { isDesktop } from 'lib/isDesktop'
import { relaunch } from '@tauri-apps/plugin-process'
import { check } from '@tauri-apps/plugin-updater'
import {
  UpdaterRestartModal,
  createUpdaterRestartModal,
} from 'components/UpdaterRestartModal'
import { AppStreamProvider } from 'AppState'

// uncomment for xstate inspector
// import { DEV } from 'env'
// import { inspect } from '@xstate/inspect'
// if (DEV)
//   inspect({
//     iframe: false,
//   })

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement)

root.render(
  <HotkeysProvider>
    <AppStreamProvider>
      <Router />
      <Toaster
        position="bottom-center"
        toastOptions={{
          style: {
            borderRadius: '3px',
          },
          className:
            'bg-chalkboard-10 dark:bg-chalkboard-90 text-chalkboard-110 dark:text-chalkboard-10 rounded-sm border-chalkboard-20/50 dark:border-chalkboard-80/50',
          success: {
            iconTheme: {
              primary: 'oklch(89% 0.16 143.4deg)',
              secondary: 'oklch(48.62% 0.1654 142.5deg)',
            },
            duration:
              window?.localStorage.getItem('playwright') === 'true'
                ? 10 // speed up e2e tests
                : 1500,
          },
        }}
      />
      <ModalContainer />
    </AppStreamProvider>
  </HotkeysProvider>
)

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals()

const runTauriUpdater = async () => {
  try {
    const update = await check()
    if (update && update.available) {
      const { date, version, body } = update
      const modal = createUpdaterModal(UpdaterModal)
      const { wantUpdate } = await modal({ date, version, body })
      if (wantUpdate) {
        await update.downloadAndInstall()
        // On macOS and Linux, the restart needs to be manually triggered
        const isNotWindows = navigator.userAgent.indexOf('Win') === -1
        if (isNotWindows) {
          const relaunchModal = createUpdaterRestartModal(UpdaterRestartModal)
          const { wantRestart } = await relaunchModal({ version })
          if (wantRestart) {
            await relaunch()
          }
        }
      }
    }
  } catch (error) {
    console.error(error)
  }
}

isDesktop() && runTauriUpdater()
