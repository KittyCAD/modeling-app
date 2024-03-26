import { DEFAULT_PROJECT_NAME } from 'lib/constants'
import {
  BaseUnit,
  SettingProps,
  Toggle,
  baseUnitsUnion,
  toggleAsArray,
} from 'lib/settings/settingsTypes'
import { Themes } from 'lib/theme'
import { isEnumMember } from './settingsUtils'
import {
  CameraSystem,
  cameraMouseDragGuards,
  cameraSystems,
} from 'lib/cameraControls'
import { FILE_EXT, PROJECT_ENTRYPOINT } from 'lib/tauriFS'
import { isTauri } from 'lib/isTauri'
import { ActionButton } from 'components/ActionButton'
import { useRef } from 'react'
import { open } from '@tauri-apps/api/dialog'

/**
 * A setting that can be set at the user or project level
 * @constructor
 */
export class Setting<T = unknown> {
  /**
   * The current value of the setting, prioritizing project, then user, then default
   */
  public current: T
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
    return this._project || this._user || this._default
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
          optionsFromContext: (context) =>
            Object.values(Themes).map((v) => ({
              name: v,
              value: v,
              isCurrent: v === context.app.theme.current,
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
        validate: (v) => typeof v === 'string' && (v.length > 0 || !isTauri()),
        Component: ({ value, onChange }) => {
          const inputRef = useRef<HTMLInputElement>(null)
          return (
            <div className="flex w-full gap-4 p-1 border rounded border-chalkboard-30">
              <input
                className="flex-1 px-2 bg-transparent"
                value={value}
                onBlur={onChange}
                disabled
                data-testid="default-directory-input"
              />
              <ActionButton
                Element="button"
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
                icon={{
                  icon: 'folder',
                }}
              >
                Choose a folder
              </ActionButton>
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
          optionsFromContext: (context) =>
            Object.values(baseUnitsUnion).map((v) => ({
              name: v,
              value: v,
              isCurrent: v === context.modeling.defaultUnit.current,
            })),
        },
      }),
      mouseControls: new Setting<CameraSystem>({
        defaultValue: 'KittyCAD',
        validate: (v) => cameraSystems.includes(v as CameraSystem),
        commandConfig: {
          inputType: 'options',
          defaultValueFromContext: (context) =>
            context.modeling.mouseControls.current,
          optionsFromContext: (context) =>
            Object.values(cameraSystems).map((v) => ({
              name: v,
              value: v,
              isCurrent: v === context.modeling.mouseControls.current,
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
            <ul className="mx-4 my-2 text-sm leading-relaxed">
              <li>
                <strong>Pan:</strong>{' '}
                {cameraMouseDragGuards[value].pan.description}
              </li>
              <li>
                <strong>Zoom:</strong>{' '}
                {cameraMouseDragGuards[value].zoom.description}
              </li>
              <li>
                <strong>Rotate:</strong>{' '}
                {cameraMouseDragGuards[value].rotate.description}
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
      }),
      moveOrthoginalToSketch: new Setting<boolean>({
        defaultValue: false,
        validate: (v) => typeof v === 'boolean',
        commandConfig: {
          inputType: 'boolean',
        },
      }),
      plumbusesOnly: new Setting<boolean>({
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
    project: {
      defaultProjectName: new Setting<string>({
        defaultValue: DEFAULT_PROJECT_NAME,
        validate: (v) => typeof v === 'string' && v.length > 0,
        commandConfig: {
          inputType: 'string',
        },
      }),
      entryPointFileName: new Setting<string>({
        defaultValue: PROJECT_ENTRYPOINT + FILE_EXT,
        validate: (v) => typeof v === 'string' && v.length > 0,
        commandConfig: {
          inputType: 'string',
        },
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
