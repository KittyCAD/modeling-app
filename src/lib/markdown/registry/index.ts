import { markdown } from '@codemirror/lang-markdown'
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { defineRegistryItemFactory, provide } from '@kittycad/registry'
import { editorCapabilityValueSpec } from '@src/lib/editors/registry/contract'
import {
  executorCapabilityValueSpec,
  executorViewValueSpec,
} from '@src/lib/executors/registry/contract'
import { markdownExecutorCapability } from '@src/lib/markdown/executor'
import { MarkdownPreview } from '@src/lib/markdown/MarkdownPreview'
import { withProjectShellFeature } from '@src/lib/projectSession/next/feature'

/** One Markdown extension contributes editor behavior, computation, and its output view. */
const extension = defineRegistryItemFactory(() => {
  return {
    id: 'markdown',
    provides: [
      provide(editorCapabilityValueSpec, {
        id: 'editors.markdown',
        matches: '.md',
        capabilities: [markdown(), syntaxHighlighting(defaultHighlightStyle)],
      }),
      provide(executorCapabilityValueSpec, markdownExecutorCapability),
      provide(executorViewValueSpec, {
        id: 'markdown.preview',
        label: 'Markdown',
        matches: '.md',
        capabilityId: markdownExecutorCapability.id,
        Component: MarkdownPreview,
      }),
    ],
  }
}, 'markdown')

export default withProjectShellFeature(extension, 'markdown')
