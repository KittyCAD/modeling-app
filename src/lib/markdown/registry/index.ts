import { markdown } from '@codemirror/lang-markdown'
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { defineRegistryItemFactory, provide } from '@kittycad/registry'
import { editorCapabilityValueSpec } from '@src/lib/editors/registry/contract'
import { withProjectShellFeature } from '@src/lib/projectSession/next/feature'

/** Markdown editing behavior, independent of execution or preview services. */
const extension = defineRegistryItemFactory(() => {
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

export default withProjectShellFeature(extension, 'markdown')
