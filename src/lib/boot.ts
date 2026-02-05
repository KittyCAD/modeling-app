import { App } from '@src/lib/app'
import React from 'react'
import { appVersion, statusBar, statusBarField } from './extension'

/**
 * This separates the instantiation of the app used by the frontend codebase
 * from its class definition. This app instance should not be referenced by any tests, but rather
 * created anew.
 */
export const app = new App([statusBar, appVersion])

window.app = app
window.statusBarField = statusBarField

/**
 * Hook to gain access to the global app instance's singletons
 */
export const useSingletons = () => React.useContext(app.ReactContext).singletons
export const useApp = () => React.useContext(app.ReactContext)
