import { markdown } from '@codemirror/lang-markdown'
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { defineRegistryItemFactory, provide } from '@kittycad/registry'
import { editorCapabilityValueSpec } from '@src/lib/editors/registry/contract'
import { IS_STAGING_OR_DEBUG } from '@src/routes/utils'

/** Markdown editing behavior, independent of execution or preview services. */
export default defineRegistryItemFactory(() => {
  if (!IS_STAGING_OR_DEBUG) return { id: 'markdown' }
  return {
    id: 'markdown',
    provides: [
      provide(editorCapabilityValueSpec, {
        id: 'editors.markdown',
        editorType: '.md',
        capabilities: [markdown(), syntaxHighlighting(defaultHighlightStyle)],
      }),
    ],
  }
}, 'markdown')
