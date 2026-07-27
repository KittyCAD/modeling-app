import type { JsonValue } from '@rust/kcl-lib/bindings/serde_json/JsonValue'
import { OPFS_CLOUD_FEATURE_FLAG } from '@src/lib/constants'
import {
  isProjectLibrarySettings,
  type ProjectLibrarySetting,
} from '@src/lib/projectLibraries'
import type { ExtensionSettingsContribution } from '@src/lib/settings/extensionSettings'
import { Setting } from '@src/lib/settings/initialSettings'
import { Suspense, lazy } from 'react'

const ProjectLibrariesSetting = lazy(() =>
  import('@src/lib/projectLibraries/settings/ProjectLibrariesSetting').then(
    (module) => ({
      default: module.ProjectLibrariesSetting,
    })
  )
)

export const projectLibrariesSettingsContribution: ExtensionSettingsContribution =
  {
    app: {
      libraries: {
        createSetting: () =>
          new Setting<ProjectLibrarySetting[]>({
            defaultValue: [],
            description: 'Project libraries shown on the home page.',
            hideOnLevel: 'project',
            hideWithoutFeatureOnPlatform: {
              web: OPFS_CLOUD_FEATURE_FLAG,
            },
            validate: isProjectLibrarySettings,
            Component: (props) => (
              <Suspense fallback={null}>
                <ProjectLibrariesSetting {...props} />
              </Suspense>
            ),
          }),
        userToml: {
          sectionKey: 'app',
          tomlKey: 'libraries',
          fromToml: (value) =>
            isProjectLibrarySettings(value) ? value : undefined,
          toToml: (value) =>
            isProjectLibrarySettings(value)
              ? (value as unknown as JsonValue)
              : undefined,
        },
      },
    },
  }
