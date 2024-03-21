import { DEFAULT_PROJECT_NAME } from 'lib/constants'
import {
  BaseUnit,
  Toggle,
  baseUnitsUnion,
  toggleAsArray,
} from 'lib/settings/settingsTypes'
import { Themes } from 'lib/theme'
import { isEnumMember } from './settingsUtils'
import { CameraSystem, cameraSystems } from 'lib/cameraControls'
import { isTauri } from 'lib/isTauri'
import { FILE_EXT, PROJECT_ENTRYPOINT, getInitialDefaultDir } from 'lib/tauriFS'

interface SettingProps<T> {
  defaultValue: T
  validate: (v: T) => boolean
}

export type SettingsLevel = 'user' | 'project'

export class Setting<T = unknown> {
  public validate: (v: T) => boolean
  private _default: T
  private _user?: T
  private _project?: T
  public current: T

  constructor(props: SettingProps<T>) {
    this._default = props.defaultValue
    this.current = props.defaultValue
    this.validate = props.validate
  }
  get default(): T { return this._default }
  set default(v: T) {
    this._default = this.validate(v) ? v : this._default
    this.current = this.resolve()
  }
  get user(): T | undefined {
    return this._user
  }
  set user(v: T) {
    this._user = this.validate(v) ? v : this._user
    this.current = this.resolve()
  }
  get project(): T | undefined {
    return this._project
  }
  set project(v: T) {
    this._project = this.validate(v) ? v : this._project
    this.current = this.resolve()
  }
  /**
   * @returns {T} - The value of the setting, prioritizing project, then user, then default
   * @todo - This may have issues if future settings can have a value that is valid but falsy
   */
  private resolve() {
    return this._project || this._user || this._default
  }
}

export function createSettings() {
  return {
    app: {
      theme: new Setting<Themes>({
        defaultValue: Themes.System,
        validate: (v) => isEnumMember(v, Themes),
      }),
      onboardingStatus: new Setting<string>({
        defaultValue: '',
        validate: (v) => typeof v === 'string',
      }),
      projectDirectory: new Setting<string>({
        defaultValue: '',
        validate: (v) => typeof v === 'string', // && (v.length > 0 || !isTauri()),
      }),
    },
    modeling: {
      defaultUnit: new Setting<BaseUnit>({
        defaultValue: 'mm',
        validate: (v) => baseUnitsUnion.includes(v as BaseUnit),
      }),
      mouseControls: new Setting<CameraSystem>({
        defaultValue: 'KittyCAD',
        validate: (v) => cameraSystems.includes(v as CameraSystem),
      }),
      showDebugPanel: new Setting<boolean>({
        defaultValue: false,
        validate: (v) => typeof v === 'boolean',
      }),
      reduceMotion: new Setting<boolean>({
        defaultValue: false,
        validate: (v) => typeof v === 'boolean',
      }),
      moveOrthoginalToSketch: new Setting<boolean>({
        defaultValue: false,
        validate: (v) => typeof v === 'boolean',
      }),
    },
    textEditor: {
      textWrapping: new Setting<Toggle>({
        defaultValue: 'On',
        validate: (v) => toggleAsArray.includes(v as Toggle),
      }),
    },
    project: {
      defaultProjectName: new Setting<string>({
        defaultValue: DEFAULT_PROJECT_NAME,
        validate: (v) => typeof v === 'string' && v.length > 0,
      }),
      entryPointFileName: new Setting<string>({
        defaultValue: PROJECT_ENTRYPOINT + FILE_EXT,
        validate: (v) => typeof v === 'string' && v.length > 0,
      }),
    },
    commandBar: {
      includeSettings: new Setting<boolean>({
        defaultValue: true,
        validate: (v) => typeof v === 'boolean',
      }),
    },
  }
}

export const settings = createSettings()
