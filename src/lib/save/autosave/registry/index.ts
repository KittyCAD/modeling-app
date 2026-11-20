import { factory, contribute } from 'plankton'
import { observations as savingObservations } from '@src/lib/save/registry/contract'
import { observations as settingsObservations } from '@src/registry/contracts/settings'
import { editorCapabilityFacet } from '@src/lib/editors/registry/contract'
import { editorMatchContext, matchesEditor } from '@src/lib/editors/matching'
import { attachAutosave } from '@src/lib/save/autosave/autosave'
import { defineBooleanExtensionSetting } from '@src/lib/settings/extensionSettings'
import { settingsFacet } from '@src/registry/contracts/settings'
import {
  withProjectShellFeature,
  PROJECT_SHELL_FEATURE,
} from '@src/lib/projectSession/next/feature'

const extension = factory({
  key: 'save.autosave',
  dependencies: { saving: savingObservations, settings: settingsObservations },
  create: ({ saving, settings }) => ({
    items: [
      contribute(editorCapabilityFacet, () => ({
        id: 'editors.autosave',
        matches: '*' as const,
        setup: (host) => {
          attachAutosave(
            host,
            saving.editorSaveService.required(),
            (editor) => {
              const required = saving.editorAutosavePoliciesFacet.value.some(
                (policy) =>
                  policy.required.value &&
                  matchesEditor(policy.matches, editorMatchContext(editor))
              )
              const setting =
                settings.settingsService.current.value?.current.value.textEditor
                  .autosave?.currentSignal.value
              return required || setting === true
            }
          )
          return undefined
        },
      })),
    ],
  }),
})

export default [
  withProjectShellFeature(extension, 'save.autosave'),
  contribute(settingsFacet, () => ({
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
  })),
]
