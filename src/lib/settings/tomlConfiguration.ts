import type { JsonValue } from '@rust/kcl-lib/bindings/serde_json/JsonValue'
import { isArray } from '@src/lib/utils'
import { TomlDate, type TomlValueWithoutBigInt } from 'smol-toml'

/** JSON-compatible extension data shared by the app and project settings parsers. */
export type JsonTable = { [key: string]: JsonValue }

export function jsonValue(value: TomlValueWithoutBigInt): JsonValue {
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

export function table(value: JsonValue): JsonTable | Error {
  if (value === null || typeof value !== 'object' || isArray(value)) {
    return new Error('Settings section must be a table')
  }
  return value
}

export function enumValue<const T extends string>(
  value: JsonValue,
  choices: readonly T[]
): T | Error {
  const parsed = choices.find((choice) => choice === value)
  if (parsed === undefined)
    return new Error(`Invalid setting: expected ${choices.join(', ')}`)
  return parsed
}

export function booleanValue(value: JsonValue): boolean | Error {
  if (typeof value !== 'boolean') return new Error('Setting must be a boolean')
  return value
}

export function stringValue(value: JsonValue): string | Error {
  if (typeof value !== 'string') return new Error('Setting must be a string')
  return value
}
