import {
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
} from '@kittycad/registry'
import { DFM_REVIEW_FEATURE_FLAG } from '@src/lib/constants'
import { createGdtToolbarItems } from '@src/lib/gdtToolbar'
import {
  type CommandSystemService,
  commandSystemService,
} from '@src/registry/contracts/commands'
import { provideMode } from '@src/registry/contracts/modes'
import { createZdsPlugin } from '@src/registry/createZdsPlugin'

export const DFM_REVIEW_PLUGIN_ID = 'dfm-review'
export const DFM_REVIEW_MODE_ID = 'dfm-review'

const dfmReviewMode = defineRegistryItemFactory((ctx) => {
  const commands: Pick<CommandSystemService, 'send'> = {
    send: (...args) => ctx.services.get(commandSystemService).send(...args),
  }

  return {
    item: defineRuntimeRegistryItem({
      id: 'dfm-review.mode',
      provides: [
        provideMode({
          id: DFM_REVIEW_MODE_ID,
          label: 'DFM Review',
          icon: 'gdtDatum',
          toolbar: createGdtToolbarItems(commands),
        }),
      ],
    }),
  }
}, 'dfm-review.mode')

export default createZdsPlugin({
  id: DFM_REVIEW_PLUGIN_ID,
  title: 'DFM Review',
  description: 'Review designs with geometric dimensions and tolerances.',
  items: [dfmReviewMode],
  defaultSetting: 'off',
  activationSetting: {
    category: 'plugins',
    settingName: DFM_REVIEW_PLUGIN_ID,
    title: 'DFM Review',
    description: 'Whether the DFM Review plugin is enabled.',
    hideOnLevel: 'project',
    hideWithoutFeature: DFM_REVIEW_FEATURE_FLAG,
    featurePolicy: {
      feature: DFM_REVIEW_FEATURE_FLAG,
      defaultEnabled: true,
      disableWithoutFeature: true,
    },
    userToml: {
      sectionKey: 'plugins',
      tomlKey: DFM_REVIEW_PLUGIN_ID,
    },
  },
})
