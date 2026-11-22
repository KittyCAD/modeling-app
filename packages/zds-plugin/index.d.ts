/** Public authoring contracts contain guest values, never live ZDS services or React components. */
export interface CommandContribution {
  id: string
  title: string
  run: () => void
}

export type SettingValue = string | boolean | number

/** User-scoped, host-rendered fields. Definitions describe data, never executable UI. */
export type SettingDefinition = {
  title: string
  description?: string
} & (
  | { type: 'string'; default: string; maxLength?: number }
  | { type: 'boolean'; default: boolean }
  | { type: 'number'; default: number; min?: number; max?: number }
)

export interface SettingsContribution {
  fields: Readonly<Record<string, SettingDefinition>>
}

/** A host-rendered SVG mark and optional wordmark linking to the ZDS Home page. */
export interface LogoLinkContribution {
  id: string
  label: string
  text?: string
  logo: {
    viewBox: readonly [number, number, number, number]
    paths: readonly string[]
  }
}

/** Each supported contribution point has a host adapter. Future SDK entry points extend this map. */
export interface Contributions {
  command: CommandContribution
  settings: SettingsContribution
  'app.logoLink': LogoLinkContribution
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
  /** Read current values of this installation's declared settings. No additional permission is needed. */
  settings: {
    getString: (key: string) => string
    getBoolean: (key: string) => boolean
    getNumber: (key: string) => number
  }
}

export type Activate = (zds: PluginAPI) => void
