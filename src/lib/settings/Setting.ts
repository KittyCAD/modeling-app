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
  public current: T
  public hideOnLevel: SettingProps<T>['hideOnLevel']
  public hideOnPlatform: SettingProps<T>['hideOnPlatform']
  public hideWithoutFeature: SettingProps<T>['hideWithoutFeature']
  public hideWithoutFeatureOnPlatform: SettingProps<T>['hideWithoutFeatureOnPlatform']
  public commandConfig: SettingProps<T>['commandConfig']
  public Component: SettingProps<T>['Component']
  public description?: string
  private validate: (v: T) => boolean
  public readonly isEnabled: (c: SettingsType) => boolean
  private _default: T
  private _user?: T
  private _project?: T

  constructor(props: SettingProps<T>) {
    this._default = props.defaultValue
    this.current = props.defaultValue
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
    return this._default
  }
  set default(v: T) {
    this._default = this.validate(v) ? v : this._default
    this.current = this.resolve()
  }
  /**
   * The user-level setting. Overrides the default, overridden by the project
   */
  get user(): T | undefined {
    return this._user
  }
  set user(v: T | undefined) {
    this._user = v !== undefined ? (this.validate(v) ? v : this._user) : v
    this.current = this.resolve()
  }
  /**
   * The project-level setting. Overrides the user and default
   */
  get project(): T | undefined {
    return this._project
  }
  set project(v: T | undefined) {
    this._project = v !== undefined ? (this.validate(v) ? v : this._project) : v
    this.current = this.resolve()
  }
  /**
   * @returns {T} - The value of the setting, prioritizing project, then user, then default
   * @todo - This may have issues if future settings can have a value that is valid but falsy
   */
  private resolve() {
    return this._project !== undefined
      ? this._project
      : this._user !== undefined
        ? this._user
        : this._default
  }
  /**
   * @param {SettingsLevel} level - The level to get the fallback for
   * @returns {T} - The value of the setting above the given level, falling back as needed
   */
  public getFallback(level: SettingsLevel | 'default'): T {
    return level === 'project'
      ? this._user !== undefined
        ? this._user
        : this._default
      : this._default
  }
  /**
   * For the purposes of showing the `current` label in the command bar,
   * is this setting at the given level the same as the given value?
   */
  public shouldShowCurrentLabel(
    level: SettingsLevel | 'default',
    valueToMatch: T
  ): boolean {
    return this[`_${level}`] === undefined
      ? this.getFallback(level) === valueToMatch
      : this[`_${level}`] === valueToMatch
  }
  public getParentLevel(level: SettingsLevel): SettingsLevel | 'default' {
    return level === 'project' ? 'user' : 'default'
  }
}
