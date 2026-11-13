import {
  defineRegistryItem,
  defineRegistryItemFactory,
  provide,
} from '@kittycad/registry'
import { editorCapabilityValueSpec } from '@src/lib/editors/registry/contract'
import { editorMatchContext, matchesEditor } from '@src/lib/editors/matching'
import {
  editorSaveService,
  editorAutosavePoliciesValueSpec,
} from '@src/lib/save/registry/contract'
import { attachAutosave } from '@src/lib/save/autosave/autosave'
import { defineBooleanExtensionSetting } from '@src/lib/settings/extensionSettings'
import {
  settingsService,
  settingsValueSpec,
} from '@src/registry/contracts/settings'
import {
  withProjectShellFeature,
  PROJECT_SHELL_FEATURE,
} from '@src/lib/projectSession/next/feature'

const extension = defineRegistryItemFactory(
  ({ services, valueSpecs }) => ({
    provides: [
      provide(editorCapabilityValueSpec, {
        id: 'editors.autosave',
        matches: '*',
        setup: (host) => {
          attachAutosave(host, services.get(editorSaveService), (editor) => {
            const required = valueSpecs
              .signal(editorAutosavePoliciesValueSpec)
              .value.some(
                (policy) =>
                  policy.required.value &&
                  matchesEditor(policy.matches, editorMatchContext(editor))
              )
            const setting =
              services.signal(settingsService).value?.current.value.textEditor
                .autosave?.currentSignal.value
            return required || setting === true
          })
          return undefined
        },
      }),
    ],
  }),
  'save.autosave'
)

export default defineRegistryItem({
  id: 'save.autosave.defaults',
  uses: [withProjectShellFeature(extension, 'save.autosave')],
  provides: [
    provide(settingsValueSpec, {
      textEditor: {
        autosave: defineBooleanExtensionSetting({
          defaultValue: true,
          title: 'Autosave',
          commandConfig: { inputType: 'boolean' },
          hideWithoutFeature: PROJECT_SHELL_FEATURE,
          description:
            'Automatically save named editor buffers after 1.5 seconds without changes. Always enabled for cloud projects.',
          hideOnLevel: 'project',
          userToml: { sectionKey: 'text_editor', tomlKey: 'autosave' },
        }),
      },
    }),
  ],
})
