import type { MlCopilotMode, WebSocketResponse } from '@kittycad/lib'

import type { UnitLength } from '@rust/kcl-lib/bindings/ModelingCmd'
import type { WarningLevel } from '@rust/kcl-lib/bindings/WarningLevel'

export const APP_NAME = 'Design Studio'
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
  HOLE: 'hole',
  SEGMENT: 'seg',
  REVOLVE: 'revolve',
  PLANE: 'plane',
  HELIX: 'helix',
  CLONE: 'clone',
  SOLID: 'solid',
  PATTERN: 'pattern',
  CHAMFER: 'chamfer',
  FILLET: 'fillet',
} as const
/** The default KCL length expression */
export const KCL_DEFAULT_LENGTH = `5`

/** The default KCL tolerance expression */
export const KCL_DEFAULT_TOLERANCE = `0.1mm`

/** The default KCL precision expression */
export const KCL_DEFAULT_PRECISION = `3`

/** The default KCL instances expression */
export const KCL_DEFAULT_INSTANCES = `3`

/** The default KCL transform arg value that means no transform */
export const KCL_DEFAULT_TRANSFORM = `0`

/** The default KCL degree expression */
export const KCL_DEFAULT_DEGREE = `360deg`

/** The default KCL vector3d origin expression */
export const KCL_DEFAULT_ORIGIN = `[0, 0, 0]`

/** The default KCL vector2d origin expression */
export const KCL_DEFAULT_ORIGIN_2D = `[0, 0]`

/** The default KCL color expression */
export const KCL_DEFAULT_COLOR = `#3c73ff`

/** The sketch mode revamp selection rgb values */
export const SKETCH_SELECTION_RGB = [255, 183, 39]
/** The sketch mode revamp selection rgb values as a string */
export const SKETCH_SELECTION_RGB_STR = SKETCH_SELECTION_RGB.join(', ')

/**
 * Converts an RGB array [r, g, b] to a single integer color value (0xRRGGBB format).
 * Used for Three.js color values that expect an integer representation.
 */
export function packRgbToColor(rgb: number[]): number {
  return (rgb[0] << 16) | (rgb[1] << 8) | rgb[2]
}
/** The sketch mode revamp selection rgb values as HEX */
export const SKETCH_SELECTION_COLOR = packRgbToColor(SKETCH_SELECTION_RGB)

/** The default KCL font point size expression */
export const KCL_DEFAULT_FONT_POINT_SIZE = `36`

/** The default KCL font scale expression */
export const KCL_DEFAULT_FONT_SCALE = `1.0`

export const SETTINGS_FILE_NAME = 'settings.toml'
export const PROJECT_SETTINGS_FILE_NAME = 'project.toml'
export const LEGACY_COOKIE_NAME = '__Secure-next-auth.session-token'
export const COOKIE_NAME_PREFIX = '__Secure-session-token-'
export const TELEMETRY_FILE_NAME = 'boot.txt'
export const TELEMETRY_RAW_FILE_NAME = 'raw-metrics.txt'
export const ENVIRONMENT_FILE_NAME = 'environment.txt'

/** Custom error message to match when rejectAllModelCommands is called
 * allows us to match if the execution of executeAst was interrupted
 * This needs to be of type WebsocketResponse, so that we can parse it back out
 * nicely on the rust side.
 * */
export const EXECUTE_AST_INTERRUPT_ERROR_STRING =
  'Force interrupt, executionIsStale, new AST requested'
const EXECUTE_AST_INTERRUPT_ERROR: WebSocketResponse = {
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

/** Toast id for the app auto-updater toast */
export const AUTO_UPDATER_TOAST_ID = 'auto-updater-toast'

/** Toast id for the insert foreign part toast */
export const INSERT_FOREIGN_TOAST_ID = 'insert-foreign-toast'

/** Toast id for the onboarding */
export const ONBOARDING_TOAST_ID = 'onboarding-toast'

/** Toast id for the wasm init err toast on web */
export const WASM_INIT_FAILED_TOAST_ID = 'wasm-init-failed-toast'

/** Local sketch axis values in KCL for operations, it could either be 'X' or 'Y' */
export const KCL_AXIS_X = 'X'
export const KCL_AXIS_Y = 'Y'
export const KCL_AXIS_Z = 'Z'

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

/** Plane names in KCL for operations */
export const KCL_PLANE_XY = 'XY'
export const KCL_PLANE_XZ = 'XZ'
export const KCL_PLANE_YZ = 'YZ'

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
export const DEFAULT_DEFAULT_LENGTH_UNIT: UnitLength = 'mm'

/**
 * When no annotation is in the KCL file to specify the defaults
 */
export const DEFAULT_EXPERIMENTAL_FEATURES: WarningLevel = {
  type: 'Deny',
}

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
  token: string // authentication token from signing in. Can be empty string
  kittycadWebSocketUrl?: string // optional override for Engine WebSocket URL
  mlephantWebSocketUrl?: string // optional override for Zookeeper WebSocket URL
}

/**
 * Signed in environment data, when you sign in on desktop
 * you will get one of these written to disk.
 */
export type EnvironmentConfigurationRuntime = {
  domain: string // same name as the file development for development.json
  kittycadWebSocketUrl?: string // optional override for Engine WebSocket URL
  mlephantWebSocketUrl?: string // optional override for Zookeeper WebSocket URL
}

export const ENVIRONMENT_CONFIGURATION_FOLDER = 'envs'

export const MAX_PROJECT_NAME_LENGTH = 240

// It's so ugh that `uuid` package doesn't export this.
export const REGEXP_UUIDV4 = /^[0-9A-F]{8}(-[0-9A-F]{4}){3}-[0-9A-F]{12}$/i

export const LOCAL_STORAGE_ML_CONVERSATIONS = 'mlConversations'
/** URL query param key we watch for prompt input
 *  we should never set this search param from the app,
 *  only read and delete.
 */
export const SEARCH_PARAM_ML_PROMPT_KEY = 'ttc-prompt'

/**
 * Number of engine connection retries within a cycle before the application stops automatically trying
 */
export const NUMBER_OF_ENGINE_RETRIES = 5

/**
 *Global timeout on pending commands, it will be bad if we hit this case.
 */
export const PENDING_COMMAND_TIMEOUT = 60_000

/** Timeout in MS to save layout */
export const LAYOUT_SAVE_THROTTLE = 500

// Copilot input
export const DEFAULT_ML_COPILOT_MODE: MlCopilotMode = 'fast'

/**
 * KCL constants defined in rust/kcl-lib/std/prelude.kcl
 * TODO: figure if how we could keep this in sync automatically
 */
export type KclPreludeBodyType = 'SURFACE' | 'SOLID'
export const KCL_PRELUDE_BODY_TYPE_SURFACE: KclPreludeBodyType = 'SURFACE'
export const KCL_PRELUDE_BODY_TYPE_SOLID: KclPreludeBodyType = 'SOLID'
export const KCL_PRELUDE_BODY_TYPE_VALUES: KclPreludeBodyType[] = [
  KCL_PRELUDE_BODY_TYPE_SURFACE,
  KCL_PRELUDE_BODY_TYPE_SOLID,
]

export type KclPreludeExtrudeMethod = 'MERGE' | 'NEW'
export const KCL_PRELUDE_EXTRUDE_METHOD_MERGE: KclPreludeExtrudeMethod = 'MERGE'
export const KCL_PRELUDE_EXTRUDE_METHOD_NEW: KclPreludeExtrudeMethod = 'NEW'
export const KCL_PRELUDE_EXTRUDE_METHOD_VALUES: KclPreludeExtrudeMethod[] = [
  KCL_PRELUDE_EXTRUDE_METHOD_MERGE,
  KCL_PRELUDE_EXTRUDE_METHOD_NEW,
]
