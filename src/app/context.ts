import type { Registry, Service, ValueSpec } from '@kittycad/registry'
import type { ReadonlySignal } from '@preact/signals'
import { createContext } from 'preact'
import { useContext } from 'preact/hooks'

export interface App {
  readonly registry: Registry
  dispose(): void
}

const AppContext = createContext<App | null>(null)

export const AppProvider = AppContext.Provider

/** The app instance for this tree. Throws rather than returning null. */
export function useApp(): App {
  const app = useContext(AppContext)
  if (!app) {
    throw new Error(
      'useApp() was called outside an <AppProvider>. Components must be rendered inside the app root.'
    )
  }
  return app
}

/**
 * A required capability.
 *
 * Resolution happens on every render, which is cheap — the registry memoises
 * service resolution behind a signal — and it means a component reads the
 * current provider rather than one captured at mount. That matters when a
 * plugin is toggled at runtime.
 */
export function useService<T>(service: Service<T>): T {
  return useApp().registry.get(service)
}

/** A capability that may not be installed. */
export function useOptionalService<T>(service: Service<T>): T | undefined {
  return useApp().registry.optional(service)
}

/**
 * The resolved value of a value spec, as a signal.
 *
 * Returns the signal rather than its value so the caller decides whether to
 * subscribe — reading `.value` in a component body subscribes it, while passing
 * the signal straight into JSX updates without re-rendering at all.
 */
export function useValueSpec<I, O>(
  valueSpec: ValueSpec<I, O>
): ReadonlySignal<O> {
  return useApp().registry.signal(valueSpec)
}
