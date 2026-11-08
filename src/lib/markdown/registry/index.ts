import { markdown } from '@codemirror/lang-markdown'
import { editorMarkdownHighlight } from '@src/editor/plugins/theme'
import { defineRegistryItemFactory, provide } from '@kittycad/registry'
import {
  codeEditorExtensionValueSpec,
  editorLanguageValueSpec,
} from '@src/lib/editors/registry/contract'
import { withProjectShellFeature } from '@src/lib/projectSession/next/feature'

/** Markdown editing behavior, independent of execution or preview services. */
const extension = defineRegistryItemFactory(() => {
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
    ],
  }
}, 'markdown')

export default withProjectShellFeature(extension, 'markdown')
