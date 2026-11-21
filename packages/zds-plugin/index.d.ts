/** Public authoring contracts contain guest values, never live ZDS services or React components. */
export interface CommandContribution {
  id: string
  title: string
  run: () => void
}

/** Each supported contribution point has a host adapter. Future SDK entry points extend this map. */
export interface Contributions {
  command: CommandContribution
}

/** API version 1. Register during activation; command handlers run only on host invocation. */
export interface PluginAPI {
  contribute: <K extends keyof Contributions>(
    kind: K,
    value: Contributions[K]
  ) => void
  ui: {
    /** Requires the declared and granted `ui.notify` permission. */
    notify: (message: string) => void
  }
}

export type Activate = (zds: PluginAPI) => void
