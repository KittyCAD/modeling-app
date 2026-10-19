import type { RegistryItem } from '@kittycad/registry'
import lspItem from '@src/lang/lsp/registry'
import billingItem from '@src/lib/billing/registry'
import cursorBlinkingItem from '@src/lib/cursorBlinking/registry'
import engineConnectionItem from '@src/lib/engineConnection/registry'
import projectLibrariesItem from '@src/lib/projectLibraries/registry'
import rustContextItem from '@src/lib/rustContext/registry'
import zookeeperItem from '@src/lib/zookeeper/registry'
import authItem from '@src/registry/extensions/auth'
import cloudSyncItem from '@src/registry/extensions/cloudSync'
import cloudSyncLibraryItem from '@src/registry/extensions/cloudSyncLibrary'
import commandsItem from '@src/registry/extensions/commands'
import engineSceneItem from '@src/registry/extensions/engineScene'
import fileOperationsItem from '@src/registry/extensions/fileOperations'
import getDesktopAppItem from '@src/registry/extensions/getDesktopApp'
import homeProjectsItem from '@src/registry/extensions/homeProjects'
import interactionPerformanceItem from '@src/registry/extensions/interactionPerformance'
import keymapItem from '@src/registry/extensions/keymap'
import layoutItem from '@src/registry/extensions/layout'
import machineManagerItem from '@src/registry/extensions/machineManager'
import markdownEditorItem from '@src/registry/extensions/markdownEditor'
import projectExplorerItem from '@src/registry/extensions/projectExplorer'
import projectSessionItem from '@src/registry/extensions/projectSession'
import routerItem from '@src/registry/extensions/router'
import runtimeItem from '@src/registry/extensions/runtime'
import settingsItem from '@src/registry/extensions/settings'
import userFeaturesItem from '@src/registry/extensions/userFeatures'
import wasmItem from '@src/registry/extensions/wasm'
import cloudSyncPluginItem from '@src/registry/plugins/cloudSync'
import codeEditorItem from '@src/registry/plugins/codeEditor'
import commandBarItem from '@src/registry/plugins/commandBar'
import publishItem from '@src/registry/plugins/publish'
import slicerItem from '@src/registry/plugins/slicer'

/** Bundled registry entrypoints available to app compositions. Imports remain eager. */
export const bundledRegistryItemCatalog = {
  'zoo:lsp': lspItem,
  'zoo:billing': billingItem,
  'zoo:cursorBlinking': cursorBlinkingItem,
  'zoo:engineConnection': engineConnectionItem,
  'zoo:projectLibraries': projectLibrariesItem,
  'zoo:rustContext': rustContextItem,
  'zoo:zookeeper': zookeeperItem,
  'zoo:auth': authItem,
  'zoo:cloudSync': cloudSyncItem,
  'zoo:cloudSyncLibrary': cloudSyncLibraryItem,
  'zoo:commands': commandsItem,
  'zoo:engineScene': engineSceneItem,
  'zoo:fileOperations': fileOperationsItem,
  'zoo:getDesktopApp': getDesktopAppItem,
  'zoo:homeProjects': homeProjectsItem,
  'zoo:interactionPerformance': interactionPerformanceItem,
  'zoo:keymap': keymapItem,
  'zoo:layout': layoutItem,
  'zoo:machineManager': machineManagerItem,
  'zoo:markdownEditor': markdownEditorItem,
  'zoo:projectExplorer': projectExplorerItem,
  'zoo:projectSession': projectSessionItem,
  'zoo:router': routerItem,
  'zoo:runtime': runtimeItem,
  'zoo:settings': settingsItem,
  'zoo:userFeatures': userFeaturesItem,
  'zoo:wasm': wasmItem,
  'zoo:cloudSyncPlugin': cloudSyncPluginItem,
  'zoo:codeEditor': codeEditorItem,
  'zoo:commandBar': commandBarItem,
  'zoo:publish': publishItem,
  'zoo:slicer': slicerItem,
} satisfies Record<string, RegistryItem | undefined>

export type BundledRegistryItemId = keyof typeof bundledRegistryItemCatalog
