import { computed, type Signal, signal } from '@preact/signals-core'
import type { SettingsType } from '@src/lib/settings/initialSettings'
import type {
  SettingProps,
  SettingsLevel,
} from '@src/lib/settings/settingsTypes'

/**
 * A setting that can be set at the user or project level
 * @constructor
 */
export class Setting<T = unknown> {
  /**
   * The current value of the setting, prioritizing project, then user, then default
   */
  public hideOnLevel: SettingProps<T>['hideOnLevel']
  public hideOnPlatform: SettingProps<T>['hideOnPlatform']
  public hideWithoutFeature: SettingProps<T>['hideWithoutFeature']
  public hideWithoutFeatureOnPlatform: SettingProps<T>['hideWithoutFeatureOnPlatform']
  public commandConfig: SettingProps<T>['commandConfig']
  public Component: SettingProps<T>['Component']
  public id: string
  public description?: string
  private validate: (v: T) => boolean
  public readonly isEnabled: (c: SettingsType) => boolean
  private _default: Signal<T>
  private _user: Signal<T | undefined> = signal(undefined)
  private _project: Signal<T | undefined> = signal(undefined)
  public currentSignal = computed(() => {
    // Only undefined means unset; false, 0, and empty strings are overrides.
    const project = this.project
    if (project !== undefined) {
      return project
    }
    const user = this.user
    return user !== undefined ? user : this.default
  })
  get current(): T {
    return this.currentSignal.peek()
  }

  constructor(props: SettingProps<T>) {
    this.id = props.id
    this._default = signal(props.defaultValue)
    this.validate = props.validate
    this.isEnabled = props.isEnabled || (() => true)
    this.description = props.description
    this.hideOnLevel = props.hideOnLevel
    this.hideOnPlatform = props.hideOnPlatform
    this.hideWithoutFeature = props.hideWithoutFeature
    this.hideWithoutFeatureOnPlatform = props.hideWithoutFeatureOnPlatform
    this.commandConfig = props.commandConfig
    this.Component = props.Component
  }

  /**
   * The default setting. Overridden by the user and project if set
   */
  get default(): T {
    return this._default.value
  }
  set default(v: T) {
    this._default.value = this.validate(v) ? v : this._default.value
  }
  /**
   * The user-level setting. Overrides the default, overridden by the project
   */
  get user(): T | undefined {
    return this._user.value
  }
  set user(v: T | undefined) {
    this._user.value =
      v !== undefined ? (this.validate(v) ? v : this._user.value) : v
  }
  /**
   * The project-level setting. Overrides the user and default
   */
  get project(): T | undefined {
    return this._project.value
  }
  set project(v: T | undefined) {
    this._project.value =
      v !== undefined ? (this.validate(v) ? v : this._project.value) : v
  }
  /**
   * @param {SettingsLevel} level - The level to get the fallback for
   * @returns {T} - The value of the setting above the given level, falling back as needed
   */
  public getFallback(level: SettingsLevel | 'default'): T {
    return level === 'project'
      ? this.user !== undefined
        ? this.user
        : this.default
      : this.default
  }
  /**
   * For the purposes of showing the `current` label in the command bar,
   * is this setting at the given level the same as the given value?
   */
  public shouldShowCurrentLabel(
    level: SettingsLevel | 'default',
    valueToMatch: T
  ): boolean {
    const value = this[level]
    return value === undefined
      ? this.getFallback(level) === valueToMatch
      : value === valueToMatch
  }
  public getParentLevel(level: SettingsLevel): SettingsLevel | 'default' {
    return level === 'project' ? 'user' : 'default'
  }
}
