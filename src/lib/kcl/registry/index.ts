import { kclExecutionSettingsRegistryItem } from '@src/lib/kcl/scene/settingsRegistry'
import { kcl } from '@kittycad/codemirror-lang-kcl'
import { editorKclHighlight } from '@src/editor/plugins/theme'
import {
  defineRegistryItem,
  defineRegistryItemFactory,
  provide,
} from '@kittycad/registry'
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

export default defineRegistryItem({
  id: 'kcl.extension',
  uses: [
    // The legacy file route needs these inputs even with project-shell editing off.
    kclExecutionSettingsRegistryItem,
    withProjectShellFeature(extension, 'kcl'),
  ],
})
