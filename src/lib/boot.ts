import { App } from '@src/lib/app'
import React from 'react'

import { isPlaywright } from '@src/lib/isPlaywright'
import {
  moduleFsViaModuleImport,
  moduleFsViaWindow,
  StorageName,
} from '@src/lib/fs-zds'

// Earliest as possible point to configure the fs layer.
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
await fsModulePromise

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

/**
 * This separates the instantiation of the app used by the frontend codebase
 * from its class definition. This app instance should not be referenced by any tests, but rather
 * created anew.
 */
export const app = App.fromDefaults()
export const AppContext = React.createContext(app)
window.app = app

/**
 * Hook to gain access to the global app instance's singletons
 *
 * Alternatively, can use `useApp` and peel needed singletons off.
 * `useSingletons` will eventually be deprecated.
 */
export const useSingletons = () => React.useContext(AppContext).singletons

/**
 * Hook to get access to the app instance.
 */
export const useApp = () => React.useContext(AppContext)
