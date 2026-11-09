import { kcl } from '@kittycad/codemirror-lang-kcl'
import { editorKclHighlight } from '@src/editor/plugins/theme'
import {
  codeEditorsExtensionFacet,
  editorLanguagesFacet,
} from '@src/lib/editors/registry/contract'
import { withProjectShellFeature } from '@src/lib/projectSession/next/feature'
import { contribute, type InputOf, type Subtree } from 'plankton'

/** KCL editing behavior, independent of execution or preview services. */
const extension: Subtree = {
  key: 'kcl',
  create: () => {
    const _editorLanguagesContribution: InputOf<typeof editorLanguagesFacet> = {
      id: 'kcl',
      matches: '.kcl',
    } satisfies InputOf<typeof editorLanguagesFacet>
    const _codeEditorsExtensionContribution: InputOf<
      typeof codeEditorsExtensionFacet
    > = {
      id: 'editors.kcl',
      matches: ({ languageId }) => languageId === 'kcl',
      extensions: [kcl(), editorKclHighlight],
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
}
export default withProjectShellFeature(extension, 'kcl')
