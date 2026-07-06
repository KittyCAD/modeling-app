import type { JsonValue } from '@rust/kcl-lib/bindings/serde_json/JsonValue'
import { Setting } from '@src/lib/settings/initialSettings'
import type { SettingProps } from '@src/lib/settings/settingsTypes'

export type ExtensionSettingTomlBinding = {
  sectionKey: string
  tomlKey: string
  fromToml: (value: JsonValue | undefined) => unknown
  toToml: (value: unknown) => JsonValue | undefined
}

export interface ExtensionSettingDefinition {
  createSetting: () => Setting<any>
  userToml?: ExtensionSettingTomlBinding
  projectToml?: ExtensionSettingTomlBinding
}

export type ExtensionSettingsContribution = Record<
  string,
  Record<string, ExtensionSettingDefinition>
>

export type ResolvedExtensionSettings = ExtensionSettingsContribution

export type DynamicSettingsCategories = Record<
  string,
  Record<string, Setting<any>>
>

export function mergeExtensionSettings(
  inputs: readonly ExtensionSettingsContribution[]
): ResolvedExtensionSettings {
  return inputs.reduce<ResolvedExtensionSettings>((merged, contribution) => {
    Object.entries(contribution).forEach(([category, settings]) => {
      merged[category] = {
        ...(merged[category] ?? {}),
        ...settings,
      }
    })

    return merged
  }, {})
}

function createBooleanTomlBinding({
  sectionKey,
  tomlKey,
}: {
  sectionKey: string
  tomlKey: string
}): ExtensionSettingTomlBinding {
  return {
    sectionKey,
    tomlKey,
    fromToml: (value) => (typeof value === 'boolean' ? value : undefined),
    toToml: (value) => (typeof value === 'boolean' ? value : undefined),
  }
}

export function defineBooleanExtensionSetting({
  userToml,
  projectToml,
  ...props
}: Omit<SettingProps<boolean>, 'validate'> & {
  userToml?: { sectionKey: string; tomlKey: string }
  projectToml?: { sectionKey: string; tomlKey: string }
}): ExtensionSettingDefinition {
  return {
    createSetting: () =>
      new Setting<boolean>({
        ...props,
        validate: (value) => typeof value === 'boolean',
      }),
    userToml: userToml ? createBooleanTomlBinding(userToml) : undefined,
    projectToml: projectToml
      ? createBooleanTomlBinding(projectToml)
      : undefined,
  }
}
