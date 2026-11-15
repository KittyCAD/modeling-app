import type { BundledRegistryItemId } from '@src/registry/catalog'

/**
 * The default ZDS composition, in registration order. Keep this list explicit:
 * adding an entrypoint to the catalog does not automatically install it.
 * Infrastructure precedes plugins, matching the original discovery order.
 */
export const defaultRegistryItemIds = [
  'zoo:lsp',
  'zoo:billing',
  'zoo:cloudProjects',
  'zoo:cursorBlinking',
  'zoo:editors',
  'zoo:engineConnection',
  'zoo:kcl',
  'zoo:markdown',
  'zoo:projectLibraries',
  'zoo:projectSessionNext',
  'zoo:rustContext',
  'zoo:zookeeper',
  'zoo:auth',
  'zoo:commands',
  'zoo:debug',
  'zoo:engineScene',
  'zoo:fileOperations',
  'zoo:getDesktopApp',
  'zoo:homeProjects',
  'zoo:interactionPerformance',
  'zoo:keymap',
  'zoo:layout',
  'zoo:machineManager',
  'zoo:markdownEditor',
  'zoo:projectExplorer',
  'zoo:projectSession',
  'zoo:router',
  'zoo:runtime',
  'zoo:settings',
  'zoo:userFeatures',
  'zoo:wasm',
  'zoo:codeEditor',
  'zoo:commandBar',
  'zoo:publish',
  'zoo:slicer',
] satisfies readonly BundledRegistryItemId[]
