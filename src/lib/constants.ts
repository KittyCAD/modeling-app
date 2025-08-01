import type { Models } from '@kittycad/lib/dist/types/src'

import type { UnitAngle, UnitLength } from '@rust/kcl-lib/bindings/ModelingCmd'

export const APP_NAME = 'Design Studio'
export const APP_DOWNLOAD_PATH = 'design-studio/download'
/** Search string in new project names to increment as an index */
export const INDEX_IDENTIFIER = '$n'
/** The maximum number of 0's to pad a default project name's index with */
export const MAX_PADDING = 7
/** The default name for a newly-created project.
 * This is used as a template for new projects, with $nnn being replaced by an index
 * This is available for users to edit as a setting.
 */
export const DEFAULT_PROJECT_NAME = 'untitled'
export const DEFAULT_PROJECT_KCL_FILE = 'main.kcl'
/** Name given the temporary "project" in the browser version of the app */
export const BROWSER_PROJECT_NAME = 'browser'
/** Name given the temporary file in the browser version of the app */
export const BROWSER_FILE_NAME = 'main'
/**
 * The default name of the project in Desktop.
 * This is prefixed by the Documents directory path.
 */
export const PROJECT_FOLDER = 'zoo-design-studio-projects'
/**
 * File extension for Design Studio's files, which are written in kcl
 * @link - https://zoo.dev/docs/kcl
 * */
export const FILE_EXT = '.kcl'
/** Default file to open when a project is opened */
export const PROJECT_ENTRYPOINT = `main${FILE_EXT}` as const
/** Thumbnail file name */
export const PROJECT_IMAGE_NAME = `thumbnail.png`
/** The localStorage key for last-opened projects */
export const FILE_PERSIST_KEY = `${PROJECT_FOLDER}-last-opened` as const
/** The default name given to new kcl files in a project */
export const DEFAULT_FILE_NAME = 'Untitled'
/** The default name for a tutorial project */
export const ONBOARDING_PROJECT_NAME = 'tutorial-project'
/**
 * The default starting constant name for various modeling operations.
 * These are used to generate unique names for new objects.
 * */
export const KCL_DEFAULT_CONSTANT_PREFIXES = {
  SKETCH: 'sketch',
  EXTRUDE: 'extrude',
  LOFT: 'loft',
  SWEEP: 'sweep',
  SHELL: 'shell',
  SEGMENT: 'seg',
  REVOLVE: 'revolve',
  PLANE: 'plane',
  HELIX: 'helix',
  CLONE: 'clone',
  SOLID: 'solid',
} as const
/** The default KCL length expression */
export const KCL_DEFAULT_LENGTH = `5`

/** The default KCL transform arg value that means no transform */
export const KCL_DEFAULT_TRANSFORM = `0`

/** The default KCL degree expression */
export const KCL_DEFAULT_DEGREE = `360`

/** The default KCL color expression */
export const KCL_DEFAULT_COLOR = `#3c73ff`

export const SETTINGS_FILE_NAME = 'settings.toml'
export const PROJECT_SETTINGS_FILE_NAME = 'project.toml'
export const COOKIE_NAME = '__Secure-next-auth.session-token'
export const TELEMETRY_FILE_NAME = 'boot.txt'
export const TELEMETRY_RAW_FILE_NAME = 'raw-metrics.txt'
export const ENVIRONMENT_FILE_NAME = 'environment.txt'

/** localStorage key to determine if we're in Playwright tests */
export const PLAYWRIGHT_KEY = 'playwright'

/** Custom error message to match when rejectAllModelCommands is called
 * allows us to match if the execution of executeAst was interrupted
 * This needs to be of type WebsocketResponse, so that we can parse it back out
 * nicely on the rust side.
 * */
export const EXECUTE_AST_INTERRUPT_ERROR_STRING =
  'Force interrupt, executionIsStale, new AST requested'
const EXECUTE_AST_INTERRUPT_ERROR: Models['WebSocketResponse_type'] = {
  success: false,
  errors: [
    {
      message: EXECUTE_AST_INTERRUPT_ERROR_STRING,
      error_code: 'bad_request',
    },
  ],
}
export const EXECUTE_AST_INTERRUPT_ERROR_MESSAGE = JSON.stringify(
  EXECUTE_AST_INTERRUPT_ERROR
)

/** The messages that appear for exporting toasts */
export const EXPORT_TOAST_MESSAGES = {
  START: 'Exporting...',
  SUCCESS: 'Exported successfully',
  FAILED: 'Export failed',
}

/** The messages that appear for "make" command toasts */
export const MAKE_TOAST_MESSAGES = {
  START: 'Starting print...',
  NO_MACHINES: 'No machines available',
  NO_MACHINE_API_IP: 'No machine api ip available',
  NO_CURRENT_MACHINE: 'No current machine available',
  NO_MACHINE_ID: 'No machine id available',
  NO_NAME: 'No name provided',
  ERROR_STARTING_PRINT: 'Error while starting print',
  SUCCESS: 'Started print successfully',
}

/** The URL for the KCL samples manifest files */
export const KCL_SAMPLES_MANIFEST_URL = '/kcl-samples/manifest.json'

/** Toast id for the app auto-updater toast */
export const AUTO_UPDATER_TOAST_ID = 'auto-updater-toast'

/** Toast id for the insert foreign part toast */
export const INSERT_FOREIGN_TOAST_ID = 'insert-foreign-toast'

/** Toast id for the onboarding */
export const ONBOARDING_TOAST_ID = 'onboarding-toast'

/** Toast id for the download app toast on web */
export const DOWNLOAD_APP_TOAST_ID = 'download-app-toast'

/** Toast id for the wasm init err toast on web */
export const WASM_INIT_FAILED_TOAST_ID = 'wasm-init-failed-toast'

/** Local sketch axis values in KCL for operations, it could either be 'X' or 'Y' */
export const KCL_AXIS_X = 'X'
export const KCL_AXIS_Y = 'Y'
export const KCL_AXIS_NEG_X = '-X'
export const KCL_AXIS_NEG_Y = '-Y'
export const KCL_DEFAULT_AXIS = 'X'

export enum AxisNames {
  X = 'x',
  Y = 'y',
  Z = 'z',
  NEG_X = '-x',
  NEG_Y = '-y',
  NEG_Z = '-z',
}
/** Semantic names of views from AxisNames */
export const VIEW_NAMES_SEMANTIC = {
  [AxisNames.X]: 'Right',
  [AxisNames.Y]: 'Back',
  [AxisNames.Z]: 'Top',
  [AxisNames.NEG_X]: 'Left',
  [AxisNames.NEG_Y]: 'Front',
  [AxisNames.NEG_Z]: 'Bottom',
} as const
/** The modeling sidebar buttons' IDs get a suffix to prevent collisions */
export const SIDEBAR_BUTTON_SUFFIX = '-pane-button'

/** Custom URL protocol our desktop registers */
export const ZOO_STUDIO_PROTOCOL = 'zoo-studio'

/**
 * A query parameter that triggers a modal
 * to "open in desktop app" when present in the URL
 */
export const ASK_TO_OPEN_QUERY_PARAM = 'ask-open-desktop'

/**
 * When no annotation is in the KCL file to specify the defaults, we use these
 * default units.
 */
export const DEFAULT_DEFAULT_ANGLE_UNIT: UnitAngle = 'degrees'

/**
 * When no annotation is in the KCL file to specify the defaults, we use these
 * default units.
 */
export const DEFAULT_DEFAULT_LENGTH_UNIT: UnitLength = 'mm'

/** Real execution. */
export const EXECUTION_TYPE_REAL = 'real'
/** Mock execution. */
export const EXECUTION_TYPE_MOCK = 'mock'
/** No execution. */
export const EXECUTION_TYPE_NONE = 'none'
/**
 * Enum of engine execution kinds.
 */
export type ExecutionType =
  | typeof EXECUTION_TYPE_REAL
  | typeof EXECUTION_TYPE_MOCK
  | typeof EXECUTION_TYPE_NONE

/** Key for setting window.localStorage.setItem and .getItem to determine if the runtime is playwright for browsers */
export const IS_PLAYWRIGHT_KEY = 'playwright'

/** Should we mark all the ML features as "beta"? */
export const IS_ML_EXPERIMENTAL = true
export const ML_EXPERIMENTAL_MESSAGE = 'This feature is experimental.'
/**
 * HTML data-* attribute for tagging elements for highlighting
 * while in the onboarding flow.
 */
export const ONBOARDING_DATA_ATTRIBUTE = 'onboarding-id'

/** A query parameter that invokes a command */
export const CMD_NAME_QUERY_PARAM = 'cmd'
/** A query parameter that invokes a command */
export const CMD_GROUP_QUERY_PARAM = 'groupId'
/** A query parameter that manually sets the engine pool the frontend should use. */
export const POOL_QUERY_PARAM = 'pool'
/** A query parameter to create a file
 * @deprecated: supporting old share links with this. For new command URLs, use "cmd"
 */
export const CREATE_FILE_URL_PARAM = 'create-file'
export const FILE_NAME_QUERY_PARAM = 'name'
export const CODE_QUERY_PARAM = 'code'
/** A query parameter to skip the sign-on view if unnecessary. */
export const IMMEDIATE_SIGN_IN_IF_NECESSARY_QUERY_PARAM =
  'immediate-sign-in-if-necessary'

// Only used by the desktop app
export const OAUTH2_DEVICE_CLIENT_ID = '2af127fb-e14e-400a-9c57-a9ed08d1a5b7'

/**
 * Signed in environment data, when you sign in on desktop
 * you will get one of these written to disk.
 */
export type EnvironmentConfiguration = {
  domain: string // same name as the file development for development.json
  pool: string // can be the empty string to indicate no pool for engine
  token: string // authentication token from signing in. Can be empty string
}

/**
 * Signed in environment data, when you sign in on desktop
 * you will get one of these written to disk.
 */
export type EnvironmentConfigurationRuntime = {
  domain: string // same name as the file development for development.json
  pool: string // can be the empty string to indicate no pool for engine
}

export const ENVIRONMENT_CONFIGURATION_FOLDER = 'envs'

export const MAX_PROJECT_NAME_LENGTH = 240
