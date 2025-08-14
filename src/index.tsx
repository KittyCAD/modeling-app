import { AppStreamProvider } from '@src/AppState'
import ReactDOM from 'react-dom/client'
import toast, { Toaster } from 'react-hot-toast'
import { HotkeysProvider } from 'react-hotkeys-hook'
import ModalContainer from 'react-modal-promise'

import { Router } from '@src/Router'
import { ToastUpdate } from '@src/components/ToastUpdate'
import '@src/index.css'
import { initPromise } from '@src/lang/wasmUtils'
import { AUTO_UPDATER_TOAST_ID } from '@src/lib/constants'
import { initializeWindowExceptionHandler } from '@src/lib/exceptions'
import { isDesktop } from '@src/lib/isDesktop'
import { markOnce } from '@src/lib/performance'
import { reportRejection } from '@src/lib/trap'
import { appActor, systemIOActor, commandBarActor } from '@src/lib/singletons'
import reportWebVitals from '@src/reportWebVitals'
import { createApplicationCommands } from '@src/lib/commandBarConfigs/applicationCommandConfig'

markOnce('code/willAuth')
initializeWindowExceptionHandler()

// Don't start the app machine until all these singletons
// are initialized, and the wasm module is loaded.
initPromise
  .then(() => {
    appActor.start()
    // Application commands must be created after the initPromise because
    // it calls WASM functions to file extensions, this dependency is not available during initialization, it is an async dependency
    commandBarActor.send({
      type: 'Add commands',
      data: {
        commands: [...createApplicationCommands({ systemIOActor })],
      },
    })
  })
  .catch(reportRejection)

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
            maxInlineSize: 'min(480px, 100%)',
          },
          className:
            'bg-chalkboard-10 dark:bg-chalkboard-90 text-chalkboard-110 dark:text-chalkboard-10 rounded-xs border-chalkboard-20/50 dark:border-chalkboard-80/50',
          success: {
            iconTheme: {
              primary: 'oklch(89% 0.16 143.4deg)',
              secondary: 'oklch(48.62% 0.1654 142.5deg)',
            },
            // We shouldn't have a different duration in tests than prod, it might
            // lead to issues.
            duration: 1500,
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

if (isDesktop()) {
  window.electron.onUpdateChecking(() => {
    const message = `Checking for updates...`
    console.log(message)
    toast.loading(message, { id: AUTO_UPDATER_TOAST_ID })
  })

  window.electron.onUpdateNotAvailable(() => {
    const message = `You're already using the latest version of the app.`
    console.log(message)
    toast.success(message, { id: AUTO_UPDATER_TOAST_ID })
  })

  window.electron.onUpdateDownloadStart(() => {
    const message = `Downloading app update...`
    console.log(message)
    toast.loading(message, { id: AUTO_UPDATER_TOAST_ID })
  })

  window.electron.onUpdateError(({ error }) => {
    console.error(error)
    toast.error('An error occurred while downloading the update.', {
      id: AUTO_UPDATER_TOAST_ID,
    })
  })

  window.electron.onUpdateDownloaded(({ version, releaseNotes }) => {
    const message = `A new update (${version}) was downloaded and will be available next time you open the app.`
    console.log(message)
    toast.custom(
      ToastUpdate({
        version,
        releaseNotes,
        onRestart: () => {
          window.electron.appRestart()
        },
        onDismiss: () => {},
      }),
      { duration: 30000, id: AUTO_UPDATER_TOAST_ID }
    )
  })
}
