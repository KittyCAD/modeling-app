import type {
  SettingDefinition,
  SettingValue,
  SettingsContribution,
} from '@zoo/zds-plugin'
import type { GuestContribution } from '@src/lib/communityPlugins/runtime'
import { isRecord } from '@src/lib/utils'
import { isErr } from '@src/lib/trap'

export const isSettingKey = (key: string) =>
  /^[a-z][a-zA-Z0-9_-]{0,63}$/.test(key)

export function isSettingValue(value: unknown): value is SettingValue {
  return (
    typeof value === 'boolean' ||
    (typeof value === 'string' && value.length <= 4000) ||
    (typeof value === 'number' && Number.isFinite(value))
  )
}

export function acceptsSettingValue(
  field: SettingDefinition,
  value: unknown
): value is SettingValue {
  if (!isSettingValue(value)) return false
  if (field.type === 'string')
    return (
      typeof value === 'string' && value.length <= (field.maxLength ?? 4000)
    )
  if (field.type === 'boolean') return typeof value === 'boolean'
  return (
    typeof value === 'number' &&
    (field.min === undefined || value >= field.min) &&
    (field.max === undefined || value <= field.max)
  )
}

/** Guest declarations become a closed set of host-renderable field types before publication. */
export function parseSettingsContribution(
  value: unknown
): SettingsContribution | Error {
  if (
    !isRecord(value) ||
    Object.keys(value).some((key) => key !== 'fields') ||
    !isRecord(value.fields)
  )
    return new Error('Settings require a fields object.')
  const raw = Object.entries(value.fields)
  if (raw.length === 0 || raw.length > 32)
    return new Error('Declare between 1 and 32 settings.')
  const fields: [string, SettingDefinition][] = []
  for (const [key, input] of raw) {
    if (
      !isSettingKey(key) ||
      !isRecord(input) ||
      typeof input.title !== 'string' ||
      !input.title.trim() ||
      input.title.length > 120 ||
      (input.description !== undefined &&
        (typeof input.description !== 'string' ||
          input.description.length > 1000))
    )
      return new Error(`Invalid settings field: ${key}`)
    const base = {
      title: input.title,
      ...(typeof input.description === 'string'
        ? { description: input.description }
        : {}),
    }
    let field: SettingDefinition
    let allowed: readonly string[]
    if (input.type === 'string' && typeof input.default === 'string') {
      if (
        input.maxLength !== undefined &&
        (typeof input.maxLength !== 'number' ||
          !Number.isInteger(input.maxLength) ||
          input.maxLength < 0 ||
          input.maxLength > 4000)
      )
        return new Error(`Invalid string limit: ${key}`)
      field = {
        ...base,
        type: 'string',
        default: input.default,
        ...(typeof input.maxLength === 'number'
          ? { maxLength: input.maxLength }
          : {}),
      }
      allowed = ['type', 'title', 'description', 'default', 'maxLength']
    } else if (input.type === 'boolean' && typeof input.default === 'boolean') {
      field = { ...base, type: 'boolean', default: input.default }
      allowed = ['type', 'title', 'description', 'default']
    } else if (input.type === 'number' && typeof input.default === 'number') {
      if (
        (input.min !== undefined &&
          (typeof input.min !== 'number' || !Number.isFinite(input.min))) ||
        (input.max !== undefined &&
          (typeof input.max !== 'number' || !Number.isFinite(input.max)))
      )
        return new Error(`Invalid numeric limits: ${key}`)
      field = {
        ...base,
        type: 'number',
        default: input.default,
        ...(typeof input.min === 'number' ? { min: input.min } : {}),
        ...(typeof input.max === 'number' ? { max: input.max } : {}),
      }
      allowed = ['type', 'title', 'description', 'default', 'min', 'max']
    } else return new Error(`Unsupported setting type or default: ${key}`)
    if (
      Object.keys(input).some((key) => !allowed.includes(key)) ||
      !acceptsSettingValue(field, field.default)
    )
      return new Error(`Invalid settings declaration: ${key}`)
    fields.push([key, Object.freeze(field)])
  }
  return { fields: Object.freeze(Object.fromEntries(fields)) }
}

export function declaredSettings(
  contributions: readonly GuestContribution[]
): SettingsContribution | undefined | Error {
  const definitions = contributions.filter((item) => item.kind === 'settings')
  if (definitions.length > 1)
    return new Error('Declare settings once per plugin.')
  return definitions.length === 0
    ? undefined
    : parseSettingsContribution(definitions[0].definition)
}

export function settingValue(
  field: SettingDefinition,
  key: string,
  values: Readonly<Record<string, SettingValue>>
): SettingValue {
  const stored = Object.hasOwn(values, key) ? values[key] : undefined
  return acceptsSettingValue(field, stored) ? stored : field.default
}

/** The caller supplies only its installation's values; guest keys never select a namespace. */
export function readPluginSetting(
  contributions: readonly GuestContribution[],
  key: string,
  values: Readonly<Record<string, SettingValue>> = {}
): SettingValue | Error {
  const definition = declaredSettings(contributions)
  if (isErr(definition)) return definition
  if (
    !isSettingKey(key) ||
    !definition ||
    !Object.hasOwn(definition.fields, key)
  )
    return new Error(`Unknown declared setting: ${key}`)
  return settingValue(definition.fields[key], key, values)
}

export type ReadPluginSetting = (
  key: string,
  contributions: readonly GuestContribution[]
) => SettingValue | Error
