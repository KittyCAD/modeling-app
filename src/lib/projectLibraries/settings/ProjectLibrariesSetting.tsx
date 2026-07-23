import { useSignals } from '@preact/signals-react/runtime'
import { isDesktop } from '@src/lib/isDesktop'
import type { ProjectLibrarySetting } from '@src/lib/projectLibraries'
import type { SettingComponentProps } from '@src/lib/settings/settingsTypes'
import { projectLibraryTypesValueSpec } from '@src/registry/contracts/projectLibraries'
import {
  filterProjectLibraryTypeOptionsForSettings,
  ProjectLibrariesSettingInput,
  projectLibraryTypeOptionsFromContributions,
} from '@src/lib/projectLibraries/settings/ProjectLibrariesSettingInput'

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
      canManageLibraries={canManageLibraries}
    />
  )
}
