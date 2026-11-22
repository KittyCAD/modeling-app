/**
 * Code-free catalog metadata shared by main and renderer startup. Required entries
 * conservatively describe the current app shell, rather than a minimal CAD host.
 */
export const bundledRegistryItemMetadata = {
  'zoo:lsp': { requiredForStartup: true },
  'zoo:billing': { requiredForStartup: true },
  'zoo:cloudProjects': { requiredForStartup: true },
  'zoo:communityPlugins': { requiredForStartup: false },
  'zoo:cursorBlinking': { requiredForStartup: true },
  'zoo:editors': { requiredForStartup: true },
  'zoo:engineConnection': { requiredForStartup: true },
  'zoo:executors': { requiredForStartup: true },
  'zoo:kcl': { requiredForStartup: true },
  'zoo:markdown': { requiredForStartup: true },
  'zoo:projectLibraries': { requiredForStartup: true },
  'zoo:projectSessionNext': { requiredForStartup: true },
  'zoo:rustContext': { requiredForStartup: true },
  'zoo:save': { requiredForStartup: true },
  'zoo:typescript': { requiredForStartup: false },
  'zoo:zookeeper': { requiredForStartup: true },
  'zoo:appHeader': { requiredForStartup: true },
  'zoo:appLogo': { requiredForStartup: false },
  'zoo:auth': { requiredForStartup: true },
  'zoo:commands': { requiredForStartup: true },
  'zoo:debug': { requiredForStartup: false },
  'zoo:engineScene': { requiredForStartup: true },
  'zoo:fileOperations': { requiredForStartup: true },
  'zoo:getDesktopApp': { requiredForStartup: false },
  'zoo:homeProjects': { requiredForStartup: true },
  'zoo:interactionPerformance': {
    requiredForStartup: false,
  },
  'zoo:keymap': { requiredForStartup: true },
  'zoo:layout': { requiredForStartup: true },
  'zoo:machineManager': { requiredForStartup: true },
  'zoo:markdownEditor': { requiredForStartup: false },
  'zoo:projectExplorer': { requiredForStartup: true },
  'zoo:projectSession': { requiredForStartup: true },
  'zoo:router': { requiredForStartup: true },
  'zoo:runtime': { requiredForStartup: true },
  'zoo:settings': { requiredForStartup: true },
  'zoo:userFeatures': { requiredForStartup: true },
  'zoo:wasm': { requiredForStartup: true },
  'zoo:codeEditor': { requiredForStartup: false },
  'zoo:commandBar': { requiredForStartup: false },
  'zoo:publish': { requiredForStartup: false },
  'zoo:slicer': { requiredForStartup: false },
}

export type BundledRegistryItemId = keyof typeof bundledRegistryItemMetadata

export function isBundledRegistryItemId(
  id: string
): id is BundledRegistryItemId {
  return Object.hasOwn(bundledRegistryItemMetadata, id)
}

/** Build-specific service requirements supplement the shell's static requirements. */
export function getRequiredRegistryItemIds(
  interactionPerformanceEnabled = false
): BundledRegistryItemId[] {
  return Object.keys(bundledRegistryItemMetadata)
    .filter(isBundledRegistryItemId)
    .filter(
      (id) =>
        bundledRegistryItemMetadata[id].requiredForStartup ||
        (id === 'zoo:interactionPerformance' && interactionPerformanceEnabled)
    )
}
