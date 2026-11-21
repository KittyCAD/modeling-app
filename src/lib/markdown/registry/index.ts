import { matchesEditor } from '@src/lib/editors/matching'
import { createElement } from 'react'
import { defineEditorView } from '@src/lib/editors/views'
import { executionContext } from '@src/lib/executors/context'
import { markdown } from '@codemirror/lang-markdown'
import { editorMarkdownHighlight } from '@src/editor/plugins/theme'
import {
  codeEditorsExtensionFacet,
  editorLanguagesFacet,
  editorFileFormatsFacet,
  editorViewsFacet,
} from '@src/lib/editors/registry/contract'
import {
  observations as executorObservations,
  executorCapabilityFacet,
} from '@src/lib/executors/registry/contract'
import { markdownExecutorCapability } from '@src/lib/markdown/executor'
import { MarkdownPreview } from '@src/lib/markdown/MarkdownPreview'
import { withProjectShellFeature } from '@src/lib/projectSession/next/feature'
import { factory, contribute, type InputOf } from 'plankton'

const language = {
  id: 'markdown',
  matches: '.md',
  mediaType: 'text/markdown',
} satisfies InputOf<typeof editorLanguagesFacet>

const editorExtensions = {
  id: 'editors.markdown',
  matches: ({ languageId }) => languageId === 'markdown',
  extensions: [
    markdown(),
    editorMarkdownHighlight.light,
    editorMarkdownHighlight.dark,
  ],
} satisfies InputOf<typeof codeEditorsExtensionFacet>

/** Markdown syntax and parsing stay usable without an installed executor service. */
const extension = factory({
  dependencies: { executors: executorObservations },
  create: ({ executors }) => {
    const preview = defineEditorView(
      executionContext(markdownExecutorCapability, () =>
        executors.executorsService.required()
      )
    )({
      id: 'markdown.preview',
      label: 'Markdown',
      matches: (context) =>
        context.backing === 'text' && matchesEditor('.md', context),
      Component: ({ context }) =>
        createElement(MarkdownPreview, { executor: context.executor }),
    })
    return {
      items: [
        contribute(editorFileFormatsFacet, () => ({
          id: 'md',
          matches: '.md' as const,
          type: 'text' as const,
        })),
        contribute(editorLanguagesFacet, () => language),
        contribute(codeEditorsExtensionFacet, () => editorExtensions),
        contribute(executorCapabilityFacet, () => markdownExecutorCapability),
        contribute(editorViewsFacet, () => preview),
      ],
    }
  },
})

export default withProjectShellFeature(extension, 'markdown')
