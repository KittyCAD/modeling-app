import { kcl } from '@kittycad/codemirror-lang-kcl'
import { editorKclHighlight } from '@src/editor/plugins/theme'
import {
  codeEditorsExtensionFacet,
  editorLanguagesFacet,
} from '@src/lib/editors/registry/contract'
import { withProjectShellFeature } from '@src/lib/projectSession/next/feature'
import { contribute, type Extension, type InputOf } from 'plankton'

const language = {
  id: 'kcl',
  matches: '.kcl',
} satisfies InputOf<typeof editorLanguagesFacet>

const editorExtensions = {
  id: 'editors.kcl',
  matches: ({ languageId }) => languageId === 'kcl',
  extensions: [kcl(), editorKclHighlight],
} satisfies InputOf<typeof codeEditorsExtensionFacet>

/** KCL editing behavior, independent of execution or preview services. */
const extension = [
  contribute(editorLanguagesFacet, () => language),
  contribute(codeEditorsExtensionFacet, () => editorExtensions),
] satisfies readonly Extension[]

export default withProjectShellFeature(extension, 'kcl')
