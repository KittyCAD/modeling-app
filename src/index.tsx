import { AppStreamProvider } from '@src/AppState'
import { Router } from '@src/Router'
import ReactDOM from 'react-dom/client'
import toast, { Toaster } from 'react-hot-toast'
import { HotkeysProvider } from 'react-hotkeys-hook'
import ModalContainer from 'react-modal-promise'
import '@src/index.css'
import type { App } from '@src/lib/app'
import {
  clearAutoUpdateDownloadProgress,
  setAutoUpdateDownloadProgress,
  setAutoUpdateReady,
} from '@src/lib/autoUpdate'
import { AppContext, app } from '@src/lib/boot'
import { createApplicationCommands } from '@src/lib/commandBarConfigs/applicationCommandConfig'
import { initializeWindowExceptionHandler } from '@src/lib/exceptions'
import monkeyPatchForBrowserTranslation from '@src/lib/monkeyPatchBrowserTranslate'
import { markOnce } from '@src/lib/performance'
import { reportRejection } from '@src/lib/trap'
import reportWebVitals from '@src/reportWebVitals'

// Here's the entry-point for the whole app 🚀
launchApp(app)

/** The initialization sequence for this app */
function launchApp(app: App) {
  initSingletonBehavior(app)
  if (window.electron) {
    initElectronBehavior(window.electron)
  }
  mountAppToReact(app)
}

/** initialize behaviors that rely on singletons */
function initSingletonBehavior(app: App) {
  const { singletons } = app
  markOnce('code/willAuth')
  initializeWindowExceptionHandler(singletons.kclManager)

  // Don't start the app machine until all these singletons
  // are initialized, and the wasm module is loaded.
  singletons.kclManager.wasmInstancePromise
    .then((wasmInstance) => {
      // Application commands must be created after the initPromise because
      // it calls WASM functions to file extensions, this dependency is not available during initialization, it is an async dependency
      app.commands.send({
        type: 'Add commands',
        data: {
          commands: [
            ...createApplicationCommands({
              app,
              wasmInstance,
            }),
          ],
        },
      })
    })
    .catch(reportRejection)
}

/** initialize behaviors that rely on electron (this is only available on desktop) */
function initElectronBehavior(electron: NonNullable<typeof window.electron>) {
  // Monkey patch to prevent issues in the web app with automated browser translation
  // This mitigates https://github.com/KittyCAD/modeling-app/issues/8667, until
  // we roll out our own i18n solution and can disable browser translation altogether.
  // https://github.com/KittyCAD/modeling-app/issues/4959
  monkeyPatchForBrowserTranslation()

  electron.onUpdateChecking(() => {
    console.log('Checking for updates...')
  })

  electron.onUpdateNotAvailable(() => {
    clearAutoUpdateDownloadProgress()
    const message = "You're already using the latest version of the app."
    console.log(message)
    toast.success(message)
  })

  electron.onUpdateDownloadStart((progress) => {
    console.log('Downloading app update...', progress)
    setAutoUpdateDownloadProgress(progress)
  })

  electron.onUpdateDownloadProgress((progress) => {
    setAutoUpdateDownloadProgress(progress)
  })

  electron.onUpdateError(({ error }) => {
    clearAutoUpdateDownloadProgress()
    console.error(error)
  })

  electron.onUpdateDownloaded(({ version, releaseNotes }) => {
    clearAutoUpdateDownloadProgress()
    setAutoUpdateReady({ version, releaseNotes })
    console.log(
      `A new update (${version}) was downloaded and is ready to install.`
    )
  })
}

/** mount the app as a React node and begin rendering its components */
function mountAppToReact(app: App) {
  const root = ReactDOM.createRoot(
    document.getElementById('root') as HTMLElement
  )

  root.render(
    <AppContext.Provider value={app}>
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
    </AppContext.Provider>
  )

  // If you want to start measuring performance in your app, pass a function
  // to log results (for example: reportWebVitals(console.log))
  // or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
  reportWebVitals()
}
