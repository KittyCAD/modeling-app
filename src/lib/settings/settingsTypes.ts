import { type Models } from '@kittycad/lib'
import { Setting, settings } from './initialSettings'
import { AtLeast, PathValue, Paths } from 'lib/types'
import { CommandArgumentConfig } from 'lib/commandTypes'
import { Themes } from 'lib/theme'
import { CameraProjectionType } from '@rust/kcl-lib/bindings/CameraProjectionType'
import {
  UnitAngle_type,
  UnitLength_type,
} from '@kittycad/lib/dist/types/src/models'
import { CameraOrbitType } from '@rust/kcl-lib/bindings/CameraOrbitType'

export interface SettingsViaQueryString {
  pool: string | null
  theme: Themes
  highlightEdges: boolean
  enableSSAO: boolean
  showScaleGrid: boolean
  cameraProjection: CameraProjectionType
  cameraOrbit: CameraOrbitType
}

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
export const baseUnitLabels = {
  in: 'Inches',
  ft: 'Feet',
  yd: 'Yards',
  mm: 'Millimeters',
  cm: 'Centimeters',
  m: 'Meters',
} as const

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

export interface SettingProps<T = unknown> {
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
   * Whether to hide the setting on a certain level.
   * This will be applied in both the settings panel and the command bar.
   */
  hideOnLevel?: SettingsLevel
  /**
   * Whether to hide the setting on a certain platform.
   * This will be applied in both the settings panel and the command bar.
   */
  hideOnPlatform?: 'web' | 'desktop' | 'both'
  /**
   * A React component to use for the setting in the settings panel.
   * If this is not provided but a commandConfig is, the `inputType`
   * of the commandConfig will be used to determine the component.
   * If this is not provided and there is no commandConfig, the
   * setting will not be able to be edited directly by the user.
   */
  Component?: React.ComponentType<{
    value: T
    updateValue: (newValue: T) => void
  }>
}

/** The levels available to set settings at.
 * `project` settings are specific and saved in the project directory.
 * `user` settings are global and saved in the app config directory.
 */
export type SettingsLevel = 'user' | 'project'

/**
 * A utility type to transform the settings object
 * such that instead of having leaves of type `Setting<T>`,
 * it has leaves of type `T`.
 */
type RecursiveSettingsPayloads<T> = {
  [P in keyof T]: T[P] extends Setting<infer U>
    ? U
    : Partial<RecursiveSettingsPayloads<T[P]>>
}

export type SaveSettingsPayload = RecursiveSettingsPayloads<typeof settings>

/**
 * Annotation names for default units are defined on rust side in
 * rust/kcl-lib/src/execution/annotations.rs
 */
export interface KclSettingsAnnotation {
  defaultLengthUnit?: UnitLength_type
  defaultAngleUnit?: UnitAngle_type
}
