import { App } from '@src/lib/app'
import React from 'react'

/**
 * This separates the instantiation of the app used by the frontend codebase
 * from its class definition. This app instance should not be referenced by any tests, but rather
 * created anew.
 */
export const app = new App()

/**
 * Hook to gain access to the global app instance's singletons
 */
export const useSingletons = () => React.useContext(app.ReactContext)
