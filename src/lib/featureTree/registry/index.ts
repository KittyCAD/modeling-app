import { featureTreeExtension } from '@src/lib/featureTree/registry/extension'
import { SCENE_BROWSER_FEATURE } from '@src/lib/sceneBrowser/featureFlag'
import { gateUserFeature } from '@src/registry/extensions/userFeatures/gate'

export default gateUserFeature('featureTree', SCENE_BROWSER_FEATURE, [
  featureTreeExtension,
])
