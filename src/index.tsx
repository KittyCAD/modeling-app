import ReactDOM from 'react-dom/client'
import './index.css'
import reportWebVitals from './reportWebVitals'
import { Toaster } from 'react-hot-toast'
import { Router } from './Router'
import { HotkeysProvider } from 'react-hotkeys-hook'
import ModalContainer from 'react-modal-promise'
import {
  checkUpdate,
  installUpdate,
  onUpdaterEvent,
} from '@tauri-apps/api/updater'
import { relaunch } from '@tauri-apps/api/process'
import { UpdaterModal, createUpdaterModal } from 'components/UpdaterModal'
import { isTauri } from 'lib/isTauri'
import { platform } from 'os'
import {
  UpdaterRelaunchModal,
  createUpdaterRelaunchModal,
} from 'components/UpdaterRelaunchModal'

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
  const unlisten = await onUpdaterEvent(({ error, status }) => {
    // This will log all updater events, including status updates and errors.
    console.log('Updater event', error, status)
  })

  try {
    const { shouldUpdate, manifest } = await checkUpdate()

    if (shouldUpdate) {
      const modal = createUpdaterModal(UpdaterModal)
      const { wantUpdate } = await modal(manifest)

      if (wantUpdate) {
        // Install the update. This will also restart the app on Windows!
        await installUpdate()

        // On macOS and Linux you will need to restart the app manually.
        // You could use this step to display another confirmation dialog.
        const isNotWindows = navigator.userAgent.indexOf('Win') === -1
        if (isNotWindows) {
          const relaunchModal = createUpdaterRelaunchModal(UpdaterRelaunchModal)
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

  // you need to call unlisten if your handler goes out of scope, for example if the component is unmounted.
  unlisten()
}
isTauri() && runTauriUpdater()
