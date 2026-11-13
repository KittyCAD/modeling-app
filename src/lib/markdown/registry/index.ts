import { markdown } from '@codemirror/lang-markdown'
import { editorMarkdownHighlight } from '@src/editor/plugins/theme'
import {
  codeEditorsExtensionFacet,
  editorLanguagesFacet,
} from '@src/lib/editors/registry/contract'
import { withProjectShellFeature } from '@src/lib/projectSession/next/feature'
import {
  extension as defineExtension,
  contribute,
  type InputOf,
  type Extension,
} from 'plankton'

/** Markdown editing behavior, independent of execution or preview services. */
const extension: Extension = defineExtension({
  key: 'markdown',
  create: () => {
    const _editorLanguagesContribution: InputOf<typeof editorLanguagesFacet> = {
      id: 'markdown',
      matches: '.md',
      mediaType: 'text/markdown',
    } satisfies InputOf<typeof editorLanguagesFacet>
    const _codeEditorsExtensionContribution: InputOf<
      typeof codeEditorsExtensionFacet
    > = {
      id: 'editors.markdown',
      matches: ({ languageId }) => languageId === 'markdown',
      extensions: [
        markdown(),
        editorMarkdownHighlight.light,
        editorMarkdownHighlight.dark,
      ],
    } satisfies InputOf<typeof codeEditorsExtensionFacet>
    return {
      items: [
        contribute(editorLanguagesFacet, () => _editorLanguagesContribution),
        contribute(
          codeEditorsExtensionFacet,
          () => _codeEditorsExtensionContribution
        ),
      ],
    }
  },
})
export default withProjectShellFeature(extension, 'markdown')
