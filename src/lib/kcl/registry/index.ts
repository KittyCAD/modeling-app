import { kcl } from '@kittycad/codemirror-lang-kcl'
import { editorKclHighlight } from '@src/editor/plugins/theme'
import { defineRegistryItemFactory, provide } from '@kittycad/registry'
import {
  codeEditorsExtensionValueSpec,
  editorLanguagesValueSpec,
} from '@src/lib/editors/registry/contract'
import { withProjectShellFeature } from '@src/lib/projectSession/next/feature'

/** KCL editing behavior, independent of execution or preview services. */
const extension = defineRegistryItemFactory(() => {
  return {
    id: 'kcl',
    provides: [
      provide(editorLanguagesValueSpec, {
        id: 'kcl',
        matches: '.kcl',
      }),

      provide(codeEditorsExtensionValueSpec, {
        id: 'editors.kcl',
        matches: ({ languageId }) => languageId === 'kcl',
        extensions: [kcl(), editorKclHighlight],
      }),
    ],
  }
}, 'kcl')

export default withProjectShellFeature(extension, 'kcl')
