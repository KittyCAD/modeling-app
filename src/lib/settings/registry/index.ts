import { defineRegistryItemFactory, provide } from '@kittycad/registry'
import { createElement } from 'react'
import {
  editorSaveService,
  editorOnSaveValueSpec,
} from '@src/lib/save/registry/contract'
import { executorViewValueSpec } from '@src/lib/executors/registry/contract'
import { withProjectShellFeature } from '@src/lib/projectSession/next/feature'
import fsZds from '@src/lib/fs-zds'
import { tomlParse } from '@src/lib/toml/registry/tomlParse'
import { SettingsEditor } from '@src/lib/settings/registry/SettingsEditor'
import { PROJECT_SETTINGS_FILE_NAME } from '@src/lib/constants'
import { readProjectMetadataFromToml } from '@src/lib/projectTomlMetadata'
import { projectSessionService } from '@src/lib/projectSession/next/contract'
import type { EditorMatchContext } from '@src/lib/editors/matching'
import { isErr } from '@src/lib/trap'

const matchesProjectSettings = ({ src }: EditorMatchContext) =>
  fsZds.basename(src) === PROJECT_SETTINGS_FILE_NAME

const extension = defineRegistryItemFactory(({ services }) => {
  return {
    id: 'settings-editor',
    provides: [
      provide(editorOnSaveValueSpec, {
        id: 'settings.projectMetadata',
        order: 100,
        matches: matchesProjectSettings,
        onSave: ({ src, contents }) => {
          const projects = services.optional(projectSessionService)
          const session = projects?.currentSession.peek()
          if (!projects || !session) return
          const project = session.project.peek()
          // A nested project.toml belongs to another project, not this opening.
          if (
            fsZds.resolve(src) !==
            fsZds.resolve(project.contents.path, PROJECT_SETTINGS_FILE_NAME)
          )
            return
          const metadata = readProjectMetadataFromToml(contents)
          if (isErr(metadata)) return metadata
          projects.updateMetadata(session, {
            title: metadata.title ?? project.contents.name,
            defaultFile: metadata.defaultFile,
          })
        },
      }),
      provide(executorViewValueSpec, {
        id: 'settings.editor',
        label: 'Settings',
        priority: 100,
        matches: matchesProjectSettings,
        capabilityId: tomlParse.id,
        Component: ({ executor }) =>
          createElement(SettingsEditor, {
            executor,
            saving: services.optional(editorSaveService),
          }),
      }),
    ],
  }
}, 'settings-editor')

export default withProjectShellFeature(extension, 'settings-editor')
