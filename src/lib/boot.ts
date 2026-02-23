import { App } from '@src/lib/app'
import React from 'react'
import { appVersion, statusBar, statusBarField } from './extension'

const coreExtensions = [statusBar, appVersion]

/**
 * This separates the instantiation of the app used by the frontend codebase
 * from its class definition. This app instance should not be referenced by any tests, but rather
 * created anew.
 */
export const app = new App(coreExtensions)
export const AppContext = React.createContext(app)

window.app = app
window.statusBarField = statusBarField
window.appVersion = appVersion

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
