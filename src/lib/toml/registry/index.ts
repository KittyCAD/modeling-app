import { createElement } from 'react'
import { defineEditorView } from '@src/lib/editors/views'
import { executionContext } from '@src/lib/executors/context'
import { editorViewValueSpec } from '@src/lib/editors/registry/contract'
import { defineRegistryItemFactory, provide } from '@kittycad/registry'
import {
  executorsService,
  executorCapabilityValueSpec,
} from '@src/lib/executors/registry/contract'
import { withProjectShellFeature } from '@src/lib/projectSession/next/feature'
import { tomlParse } from '@src/lib/toml/registry/tomlParse'

import { TomlView } from '@src/lib/toml/registry/TomlView'

const id = 'toml'

const extension = defineRegistryItemFactory(({ services }) => {
  return {
    id,
    provides: [
      provide(executorCapabilityValueSpec, tomlParse),
      provide(
        editorViewValueSpec,
        defineEditorView(
          executionContext(tomlParse, () => services.get(executorsService))
        )({
          id: 'toml.table',
          label: 'TOML',
          matches: '.toml',

          Component: ({ context }) =>
            createElement(TomlView, { executor: context.executor }),
        })
      ),
    ],
  }
}, id)

export default withProjectShellFeature(extension, id)
