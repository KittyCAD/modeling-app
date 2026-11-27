import {
  isProjectLibrarySettings,
  projectLibrarySettingsFromSerialized,
  projectLibrarySettingsToSerialized,
  type ProjectLibrarySetting,
} from '@src/lib/projectLibraries'
import type { ExtensionSettingsContribution } from '@src/lib/settings/extensionSettings'
import { Setting } from '@src/lib/settings/Setting'
import { Suspense, lazy } from 'react'

const DirectoryLibrarySetting = lazy(() =>
  import('@src/lib/projectLibraries/settings/DirectoryLibrarySetting').then(
    (module) => ({
      default: module.DirectoryLibrarySetting,
    })
  )
)

export const directoryLibrarySettingsContribution: ExtensionSettingsContribution =
  {
    app: {
      libraries: {
        createSetting: () =>
          new Setting<ProjectLibrarySetting[]>({
            defaultValue: [],
            title: 'Local Libraries',
            description: 'Folders on this computer shown as libraries on Home.',
            hideOnLevel: 'project',
            validate: isProjectLibrarySettings,
            Component: (props) => (
              <Suspense fallback={null}>
                <DirectoryLibrarySetting {...props} />
              </Suspense>
            ),
          }),
        userToml: {
          sectionKey: 'app',
          tomlKey: 'libraries',
          fromToml: projectLibrarySettingsFromSerialized,
          toToml: (value) =>
            isProjectLibrarySettings(value)
              ? projectLibrarySettingsToSerialized(value)
              : undefined,
        },
      },
    },
  }
