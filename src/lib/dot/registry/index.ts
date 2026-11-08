import { createElement } from 'react'
import { defineEditorView } from '@src/lib/editors/views'
import { executionContext } from '@src/lib/executors/context'
import { dot } from '@viz-js/lang-dot'
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { defineRegistryItemFactory, provide } from '@kittycad/registry'
import {
  editorViewValueSpec,
  codeEditorExtensionValueSpec,
} from '@src/lib/editors/registry/contract'
import {
  executorsService,
  executorCapabilityValueSpec,
} from '@src/lib/executors/registry/contract'
import { dotExecutorCapability } from '@src/lib/dot/executor'
import { GraphView } from '@src/lib/dot/GraphView'
import { withProjectShellFeature } from '@src/lib/projectSession/next/feature'

/** DOT contributes its text language, graph computation, and editable Graph mode together. */
const extension = defineRegistryItemFactory(
  ({ services }) => ({
    id: 'dot',
    provides: [
      provide(codeEditorExtensionValueSpec, {
        id: 'dot.language',
        matches: dotExecutorCapability.matches,
        extensions: [dot(), syntaxHighlighting(defaultHighlightStyle)],
      }),
      provide(executorCapabilityValueSpec, dotExecutorCapability),
      provide(
        editorViewValueSpec,
        defineEditorView(
          executionContext(dotExecutorCapability, () =>
            services.get(executorsService)
          )
        )({
          id: 'dot.graph',
          label: 'Graph',
          matches: dotExecutorCapability.matches,

          Component: ({ context }) =>
            createElement(GraphView, { executor: context.executor }),
        })
      ),
    ],
  }),
  'dot'
)
export default withProjectShellFeature(extension, 'dot')
