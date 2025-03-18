import ReactDOM from 'react-dom/client'
import './index.css'
import reportWebVitals from './reportWebVitals'
import toast, { Toaster } from 'react-hot-toast'
import { Router } from './Router'
import { HotkeysProvider } from 'react-hotkeys-hook'
import ModalContainer from 'react-modal-promise'
import { isDesktop } from 'lib/isDesktop'
import { AppStreamProvider } from 'AppState'
import { ToastUpdate } from 'components/ToastUpdate'
import { markOnce } from 'lib/performance'
import { AUTO_UPDATER_TOAST_ID } from 'lib/constants'
import { initializeWindowExceptionHandler } from 'lib/exceptions'
import { initPromise } from 'lang/wasm'
import { appActor } from 'machines/appMachine'
import { reportRejection } from 'lib/trap'
import { commandBarActor } from 'machines/commandBarMachine'

markOnce('code/willAuth')
initializeWindowExceptionHandler()

// uncomment for xstate inspector
// import { DEV } from 'env'
// import { inspect } from '@xstate/inspect'
// if (DEV)
//   inspect({
//     iframe: false,
//   })

// Don't start the app machine until all these singletons
// are initialized, and the wasm module is loaded.
initPromise
  .then(() => {
    appActor.start()
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
            'bg-chalkboard-10 dark:bg-chalkboard-90 text-chalkboard-110 dark:text-chalkboard-10 rounded-sm border-chalkboard-20/50 dark:border-chalkboard-80/50',
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
  // Listen for update download progress to begin
  // to show a loading toast.
  window.electron.onUpdateDownloadStart(() => {
    const message = `Downloading app update...`
    console.log(message)
    toast.loading(message, { id: AUTO_UPDATER_TOAST_ID })
  })
  // Listen for update download errors to show
  // an error toast and clear the loading toast.
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
