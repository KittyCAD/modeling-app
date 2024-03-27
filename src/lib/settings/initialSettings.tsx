import { DEFAULT_PROJECT_NAME } from 'lib/constants'
import {
  BaseUnit,
  SettingProps,
  SettingsLevel,
  baseUnitsUnion,
} from 'lib/settings/settingsTypes'
import { Themes } from 'lib/theme'
import { isEnumMember } from 'lib/types'
import {
  CameraSystem,
  cameraMouseDragGuards,
  cameraSystems,
} from 'lib/cameraControls'
import { PROJECT_ENTRYPOINT } from 'lib/tauriFS'
import { isTauri } from 'lib/isTauri'
import { ActionButton } from 'components/ActionButton'
import { useRef } from 'react'
import { open } from '@tauri-apps/api/dialog'
import { CustomIcon } from 'components/CustomIcon'

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
  public commandConfig: SettingProps<T>['commandConfig']
  public Component: SettingProps<T>['Component']
  private validate: (v: T) => boolean
  private _default: T
  private _user?: T
  private _project?: T

  constructor(props: SettingProps<T>) {
    this._default = props.defaultValue
    this.current = props.defaultValue
    this.validate = props.validate
    this.hideOnLevel = props.hideOnLevel
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
  set user(v: T) {
    this._user = this.validate(v) ? v : this._user
    this.current = this.resolve()
  }
  /**
   * The project-level setting. Overrides the user and default
   */
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
  public getParentLevel(level: SettingsLevel): SettingsLevel | 'default' {
    return level === 'project' ? 'user' : 'default'
  }
}

export function createSettings() {
  return {
    /** Settings that affect the behavior of the entire app,
     *  beyond just modeling or navigating, for example
     */
    app: {
      /**
       * The theme of the app: light, dark, or system
       */
      theme: new Setting<Themes>({
        defaultValue: Themes.System,
        validate: (v) => isEnumMember(v, Themes),
        commandConfig: {
          inputType: 'options',
          defaultValueFromContext: (context) => context.app.theme.current,
          options: (cmdContext, settingsContext) =>
            Object.values(Themes).map((v) => ({
              name: v,
              value: v,
              isCurrent:
                v ===
                settingsContext.app.theme[
                  cmdContext.argumentsToSubmit.level as SettingsLevel
                ],
            })),
        },
      }),
      onboardingStatus: new Setting<string>({
        defaultValue: '',
        validate: (v) => typeof v === 'string',
      }),
      projectDirectory: new Setting<string>({
        defaultValue: '',
        description: 'The directory to save and load projects from',
        hideOnLevel: 'project',
        validate: (v) => typeof v === 'string' && (v.length > 0 || !isTauri()),
        Component: ({ value, onChange }) => {
          const inputRef = useRef<HTMLInputElement>(null)
          return (
            <div className="flex gap-4 p-1 border rounded-sm border-chalkboard-30">
              <input
                className="flex-grow text-xs px-2 bg-transparent"
                value={value}
                onBlur={onChange}
                disabled
                data-testid="default-directory-input"
              />
              <button
                onClick={async () => {
                  const newValue = await open({
                    directory: true,
                    recursive: true,
                    defaultPath: value,
                    title: 'Choose a new default directory',
                  })
                  if (
                    inputRef.current &&
                    newValue &&
                    newValue !== null &&
                    !Array.isArray(newValue)
                  ) {
                    inputRef.current.value = newValue
                  }
                }}
                className="p-0 m-0 border-none hover:bg-energy-10 focus:bg-energy-10 dark:hover:bg-energy-80/50 dark:focus::bg-energy-80/50"
              >
                <CustomIcon name="folder" className="w-5 h-5" />
              </button>
            </div>
          )
        },
      }),
    },
    /**
     * Settings that affect the behavior while modeling.
     */
    modeling: {
      defaultUnit: new Setting<BaseUnit>({
        defaultValue: 'mm',
        validate: (v) => baseUnitsUnion.includes(v as BaseUnit),
        commandConfig: {
          inputType: 'options',
          defaultValueFromContext: (context) =>
            context.modeling.defaultUnit.current,
          options: (cmdContext, settingsContext) =>
            Object.values(baseUnitsUnion).map((v) => ({
              name: v,
              value: v,
              isCurrent:
                v ===
                settingsContext.modeling.defaultUnit[
                  cmdContext.argumentsToSubmit.level as SettingsLevel
                ],
            })),
        },
      }),
      mouseControls: new Setting<CameraSystem>({
        defaultValue: 'KittyCAD',
        validate: (v) => cameraSystems.includes(v as CameraSystem),
        hideOnLevel: 'project',
        commandConfig: {
          inputType: 'options',
          defaultValueFromContext: (context) =>
            context.modeling.mouseControls.current,
          options: (cmdContext, settingsContext) =>
            Object.values(cameraSystems).map((v) => ({
              name: v,
              value: v,
              isCurrent:
                v ===
                settingsContext.modeling.mouseControls[
                  cmdContext.argumentsToSubmit.level as SettingsLevel
                ],
            })),
        },
        Component: ({ value, onChange }) => (
          <>
            <select
              id="camera-controls"
              className="block w-full px-3 py-1 bg-transparent border border-chalkboard-30"
              value={value}
              onChange={onChange}
            >
              {cameraSystems.map((program) => (
                <option key={program} value={program}>
                  {program}
                </option>
              ))}
            </select>
            <ul className="mx-0 my-2 flex flex-col gap-2 text-sm">
              <li className="grid grid-cols-4 gap-1">
                <strong>Pan</strong>
                <p className="col-span-3 leading-tight">
                  {cameraMouseDragGuards[value].pan.description}
                </p>
              </li>
              <li className="grid grid-cols-4 gap-1">
                <strong>Zoom</strong>
                <p className="col-span-3 leading-tight">
                  {cameraMouseDragGuards[value].zoom.description}
                </p>
              </li>
              <li className="grid grid-cols-4 gap-1">
                <strong>Rotate</strong>
                <p className="col-span-3 leading-tight">
                  {cameraMouseDragGuards[value].rotate.description}
                </p>
              </li>
            </ul>
          </>
        ),
      }),
      showDebugPanel: new Setting<boolean>({
        defaultValue: false,
        validate: (v) => typeof v === 'boolean',
        commandConfig: {
          inputType: 'boolean',
        },
      }),
      reduceMotion: new Setting<boolean>({
        defaultValue: false,
        validate: (v) => typeof v === 'boolean',
        commandConfig: {
          inputType: 'boolean',
        },
        hideOnLevel: 'project',
      }),
      moveOrthoginalToSketch: new Setting<boolean>({
        defaultValue: false,
        validate: (v) => typeof v === 'boolean',
        commandConfig: {
          inputType: 'boolean',
        },
      }),
    },
    /**
     * Settings that affect the behavior of the KCL text editor.
     */
    textEditor: {
      textWrapping: new Setting<boolean>({
        defaultValue: true,
        validate: (v) => typeof v === 'boolean',
        commandConfig: {
          inputType: 'boolean',
        },
      }),
    },
    /**
     * Settings that affect the behavior of project management.
     */
    projects: {
      defaultProjectName: new Setting<string>({
        defaultValue: DEFAULT_PROJECT_NAME,
        validate: (v) => typeof v === 'string' && v.length > 0,
        commandConfig: {
          inputType: 'string',
          defaultValueFromContext: (context) =>
            context.projects.defaultProjectName.current,
        },
        hideOnLevel: 'project',
      }),
      entryPointFileName: new Setting<string>({
        defaultValue: PROJECT_ENTRYPOINT,
        validate: (v) => typeof v === 'string' && v.length > 0,
        commandConfig: {
          inputType: 'string',
          defaultValueFromContext: (context) =>
            context.projects.entryPointFileName.current,
        },
        hideOnLevel: 'project',
      }),
    },
    /**
     * Settings that affect the behavior of the command bar.
     */
    commandBar: {
      includeSettings: new Setting<boolean>({
        defaultValue: true,
        validate: (v) => typeof v === 'boolean',
        commandConfig: {
          inputType: 'boolean',
        },
      }),
    },
  }
}

export const settings = createSettings()
