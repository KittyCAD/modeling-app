import { useSignals } from '@preact/signals-react/runtime'
import { isDesktop } from '@src/lib/isDesktop'
import {
  DIRECTORY_PROJECT_LIBRARY_TYPE,
  type ProjectLibrarySetting,
} from '@src/lib/projectLibraries'
import {
  filterProjectLibraryTypeOptionsForSettings,
  ProjectLibrariesSettingInput,
  projectLibraryTypeOptionsFromContributions,
} from '@src/lib/projectLibraries/settings/ProjectLibrariesSettingInput'
import type { SettingComponentProps } from '@src/lib/settings/settingsTypes'
import { projectLibraryTypesValueSpec } from '@src/registry/contracts/projectLibraries'

export function ProjectLibrariesSetting({
  value,
  updateValue,
  registry,
}: SettingComponentProps<ProjectLibrarySetting[]>) {
  useSignals()
  const canManageLibraries = isDesktop()
  const libraryTypeOptions = projectLibraryTypeOptionsFromContributions(
    registry.signal(projectLibraryTypesValueSpec).value
  )
  const selectableLibraryTypeOptions =
    filterProjectLibraryTypeOptionsForSettings(libraryTypeOptions, {
      isDesktop: canManageLibraries,
    })

  return (
    <ProjectLibrariesSettingInput
      value={value}
      updateValue={updateValue}
      libraryTypeOptions={libraryTypeOptions}
      selectableLibraryTypeOptions={selectableLibraryTypeOptions}
      canAddLibraries={canManageLibraries}
      canReorderLibraries={canManageLibraries}
      canChangeLibraryType={canManageLibraries}
      canEditLibraryDetails={canManageLibraries}
      canRemoveLibrary={(library) =>
        canManageLibraries || library.type === DIRECTORY_PROJECT_LIBRARY_TYPE
      }
    />
  )
}
