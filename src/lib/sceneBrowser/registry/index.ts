import { SCENE_BROWSER_FEATURE } from '@src/lib/sceneBrowser/featureFlag'
import { sceneBrowserExtension } from '@src/lib/sceneBrowser/registry/extension'
import { gateUserFeature } from '@src/registry/extensions/userFeatures/gate'

export default gateUserFeature('sceneBrowser', SCENE_BROWSER_FEATURE, [
  sceneBrowserExtension,
])
