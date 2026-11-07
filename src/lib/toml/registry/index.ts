import { defineRegistryItemFactory, provide } from '@kittycad/registry'
import {
  executorCapabilityValueSpec,
  executorViewValueSpec,
} from '@src/lib/executors/registry/contract'
import { withProjectShellFeature } from '@src/lib/projectSession/next/feature'
import { tomlParse } from '@src/lib/toml/registry/tomlParse'

import { TomlView } from '@src/lib/toml/registry/TomlView'

const id = 'toml'

const extension = defineRegistryItemFactory(() => {
  return {
    id,
    provides: [
      provide(executorCapabilityValueSpec, tomlParse),
      provide(executorViewValueSpec, {
        id: 'toml.table',
        label: 'TOML',
        matches: '.toml',
        capabilityId: tomlParse.id,
        Component: TomlView,
      }),
    ],
  }
}, id)

export default withProjectShellFeature(extension, id)
