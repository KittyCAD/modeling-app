import { createElement } from 'react'
import { defineEditorView } from '@src/lib/editors/views'
import { executionContext } from '@src/lib/executors/context'
import { markdown } from '@codemirror/lang-markdown'
import { editorMarkdownHighlight } from '@src/editor/plugins/theme'
import { defineRegistryItemFactory, provide } from '@kittycad/registry'
import {
  codeEditorExtensionValueSpec,
  editorLanguageValueSpec,
  editorViewValueSpec,
} from '@src/lib/editors/registry/contract'
import {
  executorsService,
  executorCapabilityValueSpec,
} from '@src/lib/executors/registry/contract'
import { markdownExecutorCapability } from '@src/lib/markdown/executor'
import { MarkdownPreview } from '@src/lib/markdown/MarkdownPreview'
import { withProjectShellFeature } from '@src/lib/projectSession/next/feature'

/** One Markdown extension contributes editor behavior, computation, and its output view. */
const extension = defineRegistryItemFactory(({ services }) => {
  return {
    id: 'markdown',
    provides: [
      provide(editorLanguageValueSpec, {
        id: 'markdown',
        matches: '.md',
        mediaType: 'text/markdown',
      }),

      provide(codeEditorExtensionValueSpec, {
        id: 'editors.markdown',
        matches: ({ languageId }) => languageId === 'markdown',
        extensions: [
          markdown(),
          editorMarkdownHighlight.light,
          editorMarkdownHighlight.dark,
        ],
      }),
      provide(executorCapabilityValueSpec, markdownExecutorCapability),
      provide(
        editorViewValueSpec,
        defineEditorView(
          executionContext(markdownExecutorCapability, () =>
            services.get(executorsService)
          )
        )({
          id: 'markdown.preview',
          label: 'Markdown',
          matches: '.md',

          Component: ({ context }) =>
            createElement(MarkdownPreview, { executor: context.executor }),
        })
      ),
    ],
  }
}, 'markdown')

export default withProjectShellFeature(extension, 'markdown')
