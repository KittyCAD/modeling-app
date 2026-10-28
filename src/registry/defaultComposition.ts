import type { BundledRegistryItemId } from '@src/registry/catalog'

/**
 * The default ZDS composition, in registration order. Keep this list explicit:
 * adding an entrypoint to the catalog does not automatically install it.
 * Infrastructure precedes plugins, matching the original discovery order.
 */
export const defaultRegistryItemIds = [
  'zoo:lsp',
  'zoo:billing',
  'zoo:cursorBlinking',
  'zoo:engineConnection',
  'zoo:projectLibraries',
  'zoo:rustContext',
  'zoo:zookeeper',
  'zoo:auth',
  'zoo:cloudSync',
  'zoo:cloudSyncLibrary',
  'zoo:commands',
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
  'zoo:cloudSyncPlugin',
  'zoo:codeEditor',
  'zoo:commandBar',
  'zoo:publish',
  'zoo:slicer',
] satisfies readonly BundledRegistryItemId[]
