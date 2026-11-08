import { kcl } from '@kittycad/codemirror-lang-kcl'
import { editorKclHighlight } from '@src/editor/plugins/theme'
import { defineRegistryItemFactory, provide } from '@kittycad/registry'
import {
  editorCapabilityValueSpec,
  editorLanguageValueSpec,
} from '@src/lib/editors/registry/contract'
import { withProjectShellFeature } from '@src/lib/projectSession/next/feature'

/** KCL editing behavior, independent of execution or preview services. */
const extension = defineRegistryItemFactory(() => {
  return {
    id: 'kcl',
    provides: [
      provide(editorLanguageValueSpec, {
        id: 'kcl',
        matches: '.kcl',
      }),

      provide(editorCapabilityValueSpec, {
        id: 'editors.kcl',
        matches: ({ languageId }) => languageId === 'kcl',
        capabilities: [kcl(), editorKclHighlight],
      }),
    ],
  }
}, 'kcl')

export default withProjectShellFeature(extension, 'kcl')
