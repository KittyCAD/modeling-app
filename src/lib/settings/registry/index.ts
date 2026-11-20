import { createElement } from 'react'
import { useSignals } from '@preact/signals-react/runtime'
import { factory, contribute } from 'plankton'
import { defineEditorView } from '@src/lib/editors/views'
import { editorViewsFacet } from '@src/lib/editors/registry/contract'
import { executionContext } from '@src/lib/executors/context'
import {
  executorCapabilityFacet,
  observations as executorInputs,
} from '@src/lib/executors/registry/contract'
import {
  editorOnSaveFacet,
  observations as saveInputs,
} from '@src/lib/save/registry/contract'
import { observations as projectInputs } from '@src/lib/projectSession/next/contract'
import { withProjectShellFeature } from '@src/lib/projectSession/next/feature'
import fsZds from '@src/lib/fs-zds'
import { tomlParse } from '@src/lib/toml/registry/tomlParse'
import { SettingsEditor } from '@src/lib/settings/registry/SettingsEditor'
import { PROJECT_SETTINGS_FILE_NAME } from '@src/lib/constants'
import { readProjectMetadataFromToml } from '@src/lib/projectTomlMetadata'
import type { EditorMatchContext } from '@src/lib/editors/matching'
import { isErr } from '@src/lib/trap'

const matchesProjectSettings = ({ src }: EditorMatchContext) =>
  fsZds.basename(src) === PROJECT_SETTINGS_FILE_NAME

const extension = factory({
  key: 'settings-editor',
  dependencies: {
    executors: executorInputs,
    saving: saveInputs,
    projects: projectInputs,
  },
  create: ({ executors, saving, projects }) => {
    const view = defineEditorView(
      executionContext(tomlParse, () => executors.executorsService.required())
    )({
      id: 'settings.editor',
      label: 'Settings',
      priority: 100,
      matches: matchesProjectSettings,
      Component: ({ context }) => {
        useSignals()
        return createElement(SettingsEditor, {
          executor: context.executor,
          saving: saving.editorSaveService.current.value,
        })
      },
    })
    return {
      items: [
        contribute(executorCapabilityFacet, () => tomlParse),
        contribute(editorViewsFacet, () => view),
        contribute(editorOnSaveFacet, () => ({
          id: 'settings.projectMetadata',
          order: 100,
          matches: matchesProjectSettings,
          onSave: ({ src, contents }) => {
            const projectService = projects.projectSessionService.current.value
            const session = projectService?.currentSession.peek()
            if (!projectService || !session) return
            const project = session.project.peek()
            // Only this opening's root settings file controls its title and default file.
            if (
              fsZds.resolve(src) !==
              fsZds.resolve(project.contents.path, PROJECT_SETTINGS_FILE_NAME)
            )
              return
            const metadata = readProjectMetadataFromToml(contents)
            if (isErr(metadata)) return metadata
            projectService.updateMetadata(session, {
              title: metadata.title ?? project.contents.name,
              defaultFile: metadata.defaultFile,
            })
          },
        })),
      ],
    }
  },
})

export default withProjectShellFeature(extension, 'settings-editor')
