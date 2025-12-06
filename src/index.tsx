import { isPlaywright } from '@src/lib/isPlaywright'
import {
  moduleFsViaModuleImport,
  moduleFsViaWindow,
  StorageName,
} from '@src/lib/fs-zds'

// This was placed here since it's the highest async-awaited code block.
// ONLY ATTACH WINDOW.FSZDS DURING TESTS! Do not use window.fsZds in app code.
// This is purely for Playwright to use the fs abstraction through
// page.evaluate.
if (typeof window !== 'undefined' && isPlaywright()) {
  void moduleFsViaWindow({
    type: window.electron ? StorageName.ElectronFS : StorageName.OPFS,
    options: {},
  })
}

// Earliest as possible, configure the fs layer.
// In the future we can have the user switch between them at run-time, but
// for now, there is no intention.
let fsModulePromise
if (window.electron) {
  fsModulePromise = moduleFsViaModuleImport({
    type: StorageName.ElectronFS,
    options: {},
  })
} else {
  fsModulePromise = moduleFsViaModuleImport({
    type: StorageName.OPFS,
    options: {},
  })
}

import { AppStreamProvider } from '@src/AppState'
import ReactDOM from 'react-dom/client'
import toast, { Toaster } from 'react-hot-toast'
import { HotkeysProvider } from 'react-hotkeys-hook'
import ModalContainer from 'react-modal-promise'
import { Router } from '@src/Router'
import { ToastUpdate } from '@src/components/ToastUpdate'
import '@src/index.css'
import { createApplicationCommands } from '@src/lib/commandBarConfigs/applicationCommandConfig'
import { AUTO_UPDATER_TOAST_ID } from '@src/lib/constants'
import { initializeWindowExceptionHandler } from '@src/lib/exceptions'
import { markOnce } from '@src/lib/performance'
import type { App } from '@src/lib/app'
import { reportRejection } from '@src/lib/trap'
import reportWebVitals from '@src/reportWebVitals'
import monkeyPatchForBrowserTranslation from '@src/lib/monkeyPatchBrowserTranslate'
import { app, AppContext } from '@src/lib/boot'

// Here's the entry-point for the whole app 🚀
void fsModulePromise.then(() => launchApp(app))

/** The initialization sequence for this app */
function launchApp(app: App) {
  initSingletonBehavior(app.singletons)
  if (window.electron) {
    initElectronBehavior(window.electron)
  }
  mountAppToReact(app)
}

/** initialize behaviors that rely on singletons */
function initSingletonBehavior(singletons: App['singletons']) {
  markOnce('code/willAuth')
  initializeWindowExceptionHandler(
    singletons.kclManager,
    singletons.rustContext
  )

  // Don't start the app machine until all these singletons
  // are initialized, and the wasm module is loaded.
  singletons.kclManager.wasmInstancePromise
    .then((wasmInstance) => {
      singletons.appActor.start()
      // Application commands must be created after the initPromise because
      // it calls WASM functions to file extensions, this dependency is not available during initialization, it is an async dependency
      singletons.commandBarActor.send({
        type: 'Add commands',
        data: {
          commands: [
            ...createApplicationCommands({
              systemIOActor: singletons.systemIOActor,
              wasmInstance,
              appActor: singletons.appActor,
              setLayout: singletons.setLayout,
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
    const message = `Checking for updates...`
    console.log(message)
    toast.loading(message, { id: AUTO_UPDATER_TOAST_ID })
  })

  electron.onUpdateNotAvailable(() => {
    const message = `You're already using the latest version of the app.`
    console.log(message)
    toast.success(message, { id: AUTO_UPDATER_TOAST_ID })
  })

  electron.onUpdateDownloadStart(() => {
    const message = `Downloading app update...`
    console.log(message)
    toast.loading(message, { id: AUTO_UPDATER_TOAST_ID })
  })

  electron.onUpdateError(({ error }) => {
    console.error(error)
    toast.error('An error occurred while downloading the update.', {
      id: AUTO_UPDATER_TOAST_ID,
    })
  })

  electron.onUpdateDownloaded(({ version, releaseNotes }) => {
    const message = `A new update (${version}) was downloaded and will be available next time you open the app.`
    console.log(message)
    toast.custom(
      ToastUpdate({
        version,
        releaseNotes,
        onRestart: () => {
          electron.appRestart()
        },
        onDismiss: () => {},
      }),
      { duration: 30000, id: AUTO_UPDATER_TOAST_ID }
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
