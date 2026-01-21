import { App } from '@src/lib/app'

/**
 * This separates the instantiation of the app used by the frontend codebase
 * from its class definition. This app instance should not be referenced by any tests, but rather
 * created anew.
 */
export const app = new App()

/**
 * Hook to gain access to the global app instance's singletons
 * Available on App instances, just exported directly here for convenience.
 */
export const useSingletons = app.useSingletons
