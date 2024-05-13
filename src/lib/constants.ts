export const APP_NAME = 'Modeling App'
/** Search string in new project names to increment as an index */
export const INDEX_IDENTIFIER = '$n'
/** The maximum number of 0's to pad a default project name's index with */
export const MAX_PADDING = 7
/** The default name for a newly-created project.
 * This is used as a template for new projects, with $nnn being replaced by an index
 * This is available for users to edit as a setting.
 */
export const DEFAULT_PROJECT_NAME = 'project-$nnn'
/** Name given the temporary "project" in the browser version of the app */
export const BROWSER_PROJECT_NAME = 'browser'
/** Name given the temporary file in the browser version of the app */
export const BROWSER_FILE_NAME = 'main'
/**
 * The default name of the project in Desktop.
 * This is prefixed by the Documents directory path.
 */
export const PROJECT_FOLDER = 'zoo-modeling-app-projects'
/**
 * File extension for Modeling App's files, which are written in kcl
 * @link - https://zoo.dev/docs/kcl
 * */
export const FILE_EXT = '.kcl'
/** Default file to open when a project is opened */
export const PROJECT_ENTRYPOINT = `main${FILE_EXT}` as const
/** Thumbnail file name */
export const PROJECT_IMAGE_NAME = `main.jpg` as const
/** The localStorage key for last-opened projects */
export const FILE_PERSIST_KEY = `${PROJECT_FOLDER}-last-opened` as const
/** The default name given to new kcl files in a project */
export const DEFAULT_FILE_NAME = 'Untitled'
/** The file endings that will appear in
 * the file explorer if found in a project directory */
export const RELEVANT_FILE_TYPES = [
  'kcl',
  'fbx',
  'gltf',
  'glb',
  'obj',
  'ply',
  'step',
  'stl',
] as const
/** The default name for a tutorial project */
export const ONBOARDING_PROJECT_NAME = 'Tutorial Project $nn'
