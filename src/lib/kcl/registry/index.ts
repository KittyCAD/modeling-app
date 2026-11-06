import { kcl } from '@kittycad/codemirror-lang-kcl'
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { defineRegistryItemFactory, provide } from '@kittycad/registry'
import { editorCapabilityValueSpec } from '@src/lib/editors/registry/contract'
import { withProjectShellFeature } from '@src/lib/projectSession/next/feature'

/** KCL editing behavior, independent of execution or preview services. */
const extension = defineRegistryItemFactory(() => {
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

export default withProjectShellFeature(extension, 'kcl')
