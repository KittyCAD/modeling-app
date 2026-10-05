import type { ProjectConfiguration } from '@rust/kcl-lib/bindings/ProjectConfiguration'
import type { DeepPartial } from '@src/lib/types'
import { isArray } from '@src/lib/utils'
import { stringify } from 'smol-toml'

function hasUnrepresentableValue(value: unknown): boolean {
  if (value === null) return true
  if (typeof value === 'number') return !Number.isFinite(value)
  if (isArray(value)) return value.some(hasUnrepresentableValue)
  return (
    typeof value === 'object' &&
    Object.values(value).some(hasUnrepresentableValue)
  )
}

/**
 * Serialize configuration already normalized by readProjectSettingsFile when
 * assigning a missing project ID. Missing files still get all three core
 * sections. Reject null extension data instead of letting smol-toml omit it.
 * General settings saves retain their separate serialization path.
 */
export function serializeLoadedProjectSettings(
  configuration: DeepPartial<ProjectConfiguration>
): string | Error {
  const normalized = {
    ...configuration,
    settings: {
      ...configuration.settings,
      meta: configuration.settings?.meta ?? {},
      app: configuration.settings?.app ?? {},
      modeling: configuration.settings?.modeling ?? {},
    },
  }
  if (hasUnrepresentableValue(normalized)) {
    return new Error('Project settings contain a value TOML cannot represent')
  }
  try {
    return stringify(normalized)
  } catch (cause) {
    return new Error('Could not serialize loaded project settings', { cause })
  }
}
