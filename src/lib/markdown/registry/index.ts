import { markdown } from '@codemirror/lang-markdown'
import { editorMarkdownHighlight } from '@src/editor/plugins/theme'
import {
  codeEditorsExtensionFacet,
  editorLanguagesFacet,
} from '@src/lib/editors/registry/contract'
import { withProjectShellFeature } from '@src/lib/projectSession/next/feature'
import { contribute, type Extension, type InputOf } from 'plankton'

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

/** Markdown editing behavior, independent of execution or preview services. */
const extension = [
  contribute(editorLanguagesFacet, () => language),
  contribute(codeEditorsExtensionFacet, () => editorExtensions),
] satisfies readonly Extension[]

export default withProjectShellFeature(extension, 'markdown')
