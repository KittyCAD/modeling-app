import { SCENE_BROWSER_FOCUSED_SCOPE } from '@src/lib/sceneBrowser/registry/contract'

export const FEATURE_TREE_FOCUSED_SCOPE = SCENE_BROWSER_FOCUSED_SCOPE
export const FEATURE_TREE_COMMANDS = {
  actions: 'zds.featureTree.focusActions',
  row: 'zds.featureTree.focusRow',
  menu: 'zds.featureTree.contextMenu',
} as const
