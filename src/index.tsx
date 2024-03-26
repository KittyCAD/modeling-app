import ReactDOM from 'react-dom/client'
import './index.css'
import reportWebVitals from './reportWebVitals'
import { Toaster } from 'react-hot-toast'
import { Router } from './Router'
import { HotkeysProvider } from 'react-hotkeys-hook'
import ModalContainer from 'react-modal-promise'
import { checkUpdate, installUpdate } from '@tauri-apps/api/updater'
import { relaunch } from '@tauri-apps/api/process'
import { UpdaterModal, createUpdaterModal } from 'components/UpdaterModal'
import { isTauri } from 'lib/isTauri'
import {
  UpdaterRestartModal,
  createUpdaterRestartModal,
} from 'components/UpdaterRestartModal'

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
    <Router />
    <Toaster
      position="top-center"
      toastOptions={{
        style: {
          borderRadius: '0.25rem',
        },
        className:
          'bg-chalkboard-10 dark:bg-chalkboard-90 text-chalkboard-110 dark:text-chalkboard-10 rounded-sm border-chalkboard-20/50 dark:border-chalkboard-80/50',
        success: {
          iconTheme: {
            primary: 'oklch(93.31% 0.227 122.3deg)',
            secondary: 'oklch(24.49% 0.01405 158.7deg)',
          },
          duration: 1500,
        },
      }}
    />
    <ModalContainer />
  </HotkeysProvider>
)

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals()

const runTauriUpdater = async () => {
  try {
    const { shouldUpdate, manifest } = await checkUpdate()
    if (shouldUpdate) {
      const modal = createUpdaterModal(UpdaterModal)
      const { wantUpdate } = await modal(manifest)
      if (wantUpdate) {
        await installUpdate()
        // On macOS and Linux, the restart needs to be manually triggered
        const isNotWindows = navigator.userAgent.indexOf('Win') === -1
        if (isNotWindows) {
          const relaunchModal = createUpdaterRestartModal(UpdaterRestartModal)
          const { wantRestart } = await relaunchModal(manifest)
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

isTauri() && runTauriUpdater()
