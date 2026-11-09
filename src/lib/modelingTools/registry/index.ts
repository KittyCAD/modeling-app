import {
  defineRegistryItemFactory,
  provide,
  provideService,
} from '@kittycad/registry'
import { kclSceneViewExtensionsValueSpec } from '@src/lib/kcl/registry/contract'
import { ModelingToolbar } from '@src/lib/modelingTools/ModelingToolbar'
import {
  modelingToolsService,
  modelingToolsValueSpec,
} from '@src/lib/modelingTools/registry/contract'
import { createModelingTools } from '@src/lib/modelingTools/tools'
import { withProjectShellFeature } from '@src/lib/projectSession/next/feature'
import {
  commandSystemService,
  commandsValueSpec,
} from '@src/registry/contracts/commands'
import { createElement } from 'react'

export const modelingToolsExtension = defineRegistryItemFactory(
  ({ services, valueSpecs }) => ({
    provides: [
      provide(kclSceneViewExtensionsValueSpec, {
        id: 'modeling-tools.toolbar',
        zone: 'top',
        wrapperClassName: 'w-full min-w-0 flex justify-center',
        Component: ({ target, active }) =>
          active
            ? createElement(ModelingToolbar, {
                target,
                tools: services.get(modelingToolsService),
              })
            : null,
      }),
    ],
    providesServices: [
      provideService(
        modelingToolsService,
        createModelingTools(
          valueSpecs.signal(modelingToolsValueSpec),
          valueSpecs.signal(commandsValueSpec),
          (event) => services.get(commandSystemService).send(event)
        )
      ),
    ],
  }),
  'modeling-tools'
)

export default withProjectShellFeature(modelingToolsExtension, 'modeling-tools')
