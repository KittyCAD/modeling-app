import { type Models } from '@kittycad/lib'
import { settings } from './initialSettings'
import { AtLeast, PathValue, Paths } from 'lib/types'
import { ChangeEventHandler } from 'react'
import { CommandArgumentConfig } from 'lib/commandTypes'

export enum UnitSystem {
  Imperial = 'imperial',
  Metric = 'metric',
}

export const baseUnits = {
  imperial: ['in', 'ft', 'yd'],
  metric: ['mm', 'cm', 'm'],
} as const

export type BaseUnit = Models['UnitLength_type']

export const baseUnitsUnion = Object.values(baseUnits).flatMap((v) => v)

export type Toggle = 'On' | 'Off'
export const toggleAsArray = ['On', 'Off'] as const

export type SettingsPaths = Exclude<
  Paths<typeof settings, 1>,
  keyof typeof settings
>
type SetEvent<T extends SettingsPaths> = {
  type: `set.${T}`
  data: {
    level: SettingsLevel
    value: PathValue<typeof settings, T>['default']
  }
}

export type SetEventTypes = SetEvent<SettingsPaths>

export type WildcardSetEvent<T extends SettingsPaths = SettingsPaths> = {
  type: `*`
  data: {
    level: SettingsLevel
    value: PathValue<typeof settings, T>['default']
  }
}

export interface SettingProps<T> {
  /**
   * The default value of the setting, used if no user or project value is set
   */
  defaultValue: T
  /**
   * The name of the setting, used in the settings panel
   */
  title?: string
  /**
   * A description of the setting, used in the settings panel
   */
  description?: string
  /**
   * A function that validates the setting value.
   * You can use this to either do simple type checks,
   * or do more thorough validation that
   * can't be done with TypeScript types alone.
   * @param v - The value to validate
   * @returns {boolean} - Whether the value is valid
   * @example
   * ```ts
   * const mySetting = new Setting<number>({
   *   defaultValue: 0,
   *   validate: (v) => v >= 0, // Only allow positive numbers
   * })
   * ```
   */
  validate: (v: T) => boolean
  /**
   * A command argument configuration for the setting.
   * If this is provided, the setting will appear in the command bar.
   */
  commandConfig?: AtLeast<CommandArgumentConfig<T>, 'inputType'>
  /**
   * A React component to use for the setting in the settings panel.
   * If this is not provided but a commandConfig is, the `inputType`
   * of the commandConfig will be used to determine the component.
   * If this is not provided and there is no commandConfig, the
   * setting will not be able to be edited directly by the user.
   */
  Component?: React.ComponentType<{
    value: T
    onChange: ChangeEventHandler
  }>
}

export type SettingsLevel = 'user' | 'project'
