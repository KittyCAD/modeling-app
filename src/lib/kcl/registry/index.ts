import { kcl } from '@kittycad/codemirror-lang-kcl'
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { defineRegistryItemFactory, provide } from '@kittycad/registry'
import { editorCapabilityValueSpec } from '@src/lib/editors/registry/contract'
import { IS_STAGING_OR_DEBUG } from '@src/routes/utils'

/** KCL editing behavior, independent of execution or preview services. */
export default defineRegistryItemFactory(() => {
  if (!IS_STAGING_OR_DEBUG) return { id: 'kcl' }
  return {
    id: 'kcl',
    provides: [
      provide(editorCapabilityValueSpec, {
        id: 'editors.kcl',
        editorType: '.kcl',
        capabilities: [kcl(), syntaxHighlighting(defaultHighlightStyle)],
      }),
    ],
  }
}, 'kcl')
