import type { AppSettings } from '@rust/kcl-lib/bindings/AppSettings'
import type { AppearanceSettings } from '@rust/kcl-lib/bindings/AppearanceSettings'
import type { Configuration } from '@rust/kcl-lib/bindings/Configuration'
import type { ModelingSettings } from '@rust/kcl-lib/bindings/ModelingSettings'
import type { Settings } from '@rust/kcl-lib/bindings/Settings'
import type { JsonValue } from '@rust/kcl-lib/bindings/serde_json/JsonValue'
import { isErr } from '@src/lib/trap'
import { isArray } from '@src/lib/utils'
import {
  TomlDate,
  type TomlTableWithoutBigInt,
  type TomlValueWithoutBigInt,
} from 'smol-toml'

type JsonTable = { [key: string]: JsonValue }

function jsonValue(value: TomlValueWithoutBigInt): JsonValue {
  if (value instanceof TomlDate) {
    // Match the Rust TOML-to-JSON representation of extension settings.
    return {
      $__toml_private_datetime: value
        .toISOString()
        .replace(/\.000(?=Z|[+-]|$)/, ''),
    }
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'object') return value
  if (isArray(value)) return value.map(jsonValue)
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, jsonValue(item)])
  )
}

function table(value: JsonValue): JsonTable | Error {
  if (value === null || typeof value !== 'object' || isArray(value)) {
    return new Error('App settings section must be a table')
  }
  return value
}

function enumValue<const T extends string>(
  value: JsonValue,
  choices: readonly T[]
): T | Error {
  const parsed = choices.find((choice) => choice === value)
  if (parsed === undefined)
    return new Error(`Invalid app setting: expected ${choices.join(', ')}`)
  return parsed
}

function booleanValue(value: JsonValue): boolean | Error {
  if (typeof value !== 'boolean')
    return new Error('App setting must be a boolean')
  return value
}

function stringValue(value: JsonValue): string | Error {
  if (typeof value !== 'string')
    return new Error('App setting must be a string')
  return value
}

function appearanceSettings(value: JsonValue): AppearanceSettings | Error {
  const section = table(value)
  if (isErr(section)) return section
  const { theme, ...other } = section
  const appearance: AppearanceSettings = other
  if (theme !== undefined) {
    const parsed = enumValue(theme, ['light', 'dark', 'system'])
    if (isErr(parsed)) return parsed
    appearance.theme = parsed
  }
  return appearance
}

function streamIdleMode(value: JsonValue): number | undefined {
  const defaultTimeout = 300000
  if (value === true) return defaultTimeout
  if (typeof value === 'string') {
    if (!/^\+?\d+$/.test(value)) return defaultTimeout
    const timeout = Number(value)
    return timeout <= 4294967295 ? timeout : defaultTimeout
  }
  if (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 4294967295
  ) {
    return value
  }
  return undefined
}

function appSettings(value: JsonValue): AppSettings | Error {
  const section = table(value)
  if (isErr(section)) return section
  const {
    appearance,
    stream_idle_mode,
    streamIdleMode: legacyTimeout,
    ...other
  } = section
  if (stream_idle_mode !== undefined && legacyTimeout !== undefined) {
    return new Error('Duplicate stream_idle_mode setting')
  }
  const app: AppSettings = other
  if (appearance !== undefined) {
    const parsed = appearanceSettings(appearance)
    if (isErr(parsed)) return parsed
    app.appearance = parsed
  }
  const timeout = streamIdleMode(stream_idle_mode ?? legacyTimeout ?? false)
  if (timeout !== undefined) app.stream_idle_mode = timeout
  return app
}

function modelingSettings(value: JsonValue): ModelingSettings | Error {
  const section = table(value)
  if (isErr(section)) return section
  const {
    base_unit,
    camera_projection,
    camera_orbit,
    highlight_edges,
    enable_ssao,
    backface_color,
    show_scale_grid,
    fixed_size_grid,
    ...other
  } = section
  const modeling: ModelingSettings = other
  if (base_unit !== undefined) {
    const parsed = enumValue(base_unit, ['mm', 'cm', 'm', 'in', 'ft', 'yd'])
    if (isErr(parsed)) return parsed
    modeling.base_unit = parsed
  }
  if (camera_projection !== undefined) {
    const parsed = enumValue(camera_projection, ['perspective', 'orthographic'])
    if (isErr(parsed)) return parsed
    modeling.camera_projection = parsed
  }
  if (camera_orbit !== undefined) {
    const parsed = enumValue(camera_orbit, ['spherical', 'trackball'])
    if (isErr(parsed)) return parsed
    modeling.camera_orbit = parsed
  }
  if (highlight_edges !== undefined) {
    const parsed = booleanValue(highlight_edges)
    if (isErr(parsed)) return parsed
    modeling.highlight_edges = parsed
  }
  if (enable_ssao !== undefined) {
    const parsed = booleanValue(enable_ssao)
    if (isErr(parsed)) return parsed
    modeling.enable_ssao = parsed
  }
  if (backface_color !== undefined) {
    const parsed = stringValue(backface_color)
    if (isErr(parsed)) return parsed
    modeling.backface_color = parsed
  }
  if (show_scale_grid !== undefined) {
    const parsed = booleanValue(show_scale_grid)
    if (isErr(parsed)) return parsed
    modeling.show_scale_grid = parsed
  }
  if (fixed_size_grid !== undefined) {
    const parsed = booleanValue(fixed_size_grid)
    if (isErr(parsed)) return parsed
    modeling.fixed_size_grid = parsed
  }
  return modeling
}

/**
 * Construct app configuration from parsed TOML without depending on Wasm.
 * Keep the Rust schema's omissions, legacy timeout coercion, and JSON extension
 * values while producing the typed configuration consumed by settings loaders.
 */
export function appConfigurationFromToml(
  parsed: TomlTableWithoutBigInt
): Configuration | Error {
  if (parsed.settings === undefined) return {}
  const section = table(jsonValue(parsed.settings))
  if (isErr(section)) return section
  const { app, modeling, ...other } = section
  const settings: Settings = other
  if (app !== undefined) {
    const parsedApp = appSettings(app)
    if (isErr(parsedApp)) return parsedApp
    settings.app = parsedApp
  }
  if (modeling !== undefined) {
    const parsedModeling = modelingSettings(modeling)
    if (isErr(parsedModeling)) return parsedModeling
    settings.modeling = parsedModeling
  }
  return Object.keys(settings).length ? { settings } : {}
}
