import { useSignals } from '@preact/signals-react/runtime'
import type { ProjectLibrarySetting } from '@src/lib/projectLibraries'
import type { SettingComponentProps } from '@src/lib/settings/settingsTypes'
import { projectLibraryTypesValueSpec } from '@src/registry/contracts/projectLibraries'
import {
  ProjectLibrariesSettingInput,
  projectLibraryTypeOptionsFromContributions,
} from '@src/lib/projectLibraries/settings/ProjectLibrariesSettingInput'

export function ProjectLibrariesSetting({
  value,
  updateValue,
  registry,
}: SettingComponentProps<ProjectLibrarySetting[]>) {
  useSignals()
  const libraryTypeOptions = projectLibraryTypeOptionsFromContributions(
    registry.signal(projectLibraryTypesValueSpec).value
  )

  return (
    <ProjectLibrariesSettingInput
      value={value}
      updateValue={updateValue}
      libraryTypeOptions={libraryTypeOptions}
    />
  )
}
