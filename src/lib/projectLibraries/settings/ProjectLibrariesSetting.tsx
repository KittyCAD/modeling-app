import { useSignals } from '@preact/signals-react/runtime'
import { isDesktop } from '@src/lib/isDesktop'
import {
  canRemoveProjectLibrary,
  CLOUD_PROJECT_LIBRARY_TYPE,
  type ProjectLibrarySetting,
} from '@src/lib/projectLibraries'
import {
  filterProjectLibraryTypeOptionsForSettings,
  ProjectLibrariesSettingInput,
  projectLibraryTypeOptionsFromContributions,
} from '@src/lib/projectLibraries/settings/ProjectLibrariesSettingInput'
import type { SettingComponentProps } from '@src/lib/settings/settingsTypes'
import { projectLibraryTypesFacet } from '@src/registry/contracts/projectLibraries'
import { useMemo } from 'react'

export function ProjectLibrariesSetting({
  value,
  updateValue,
  registry,
}: SettingComponentProps<ProjectLibrarySetting[]>) {
  useSignals()
  const canManageLibraries = isDesktop()
  const libraryTypeOptions = projectLibraryTypeOptionsFromContributions(
    registry.observe(projectLibraryTypesFacet).value
  )
  const localLibraries = useMemo(
    () =>
      value.filter((library) => library.type !== CLOUD_PROJECT_LIBRARY_TYPE),
    [value]
  )
  const selectableLibraryTypeOptions =
    filterProjectLibraryTypeOptionsForSettings(libraryTypeOptions, {
      isDesktop: canManageLibraries,
    })

  return (
    <ProjectLibrariesSettingInput
      value={localLibraries}
      updateValue={(libraries) =>
        updateValue([
          ...libraries,
          ...value.filter(
            (library) => library.type === CLOUD_PROJECT_LIBRARY_TYPE
          ),
        ])
      }
      libraryTypeOptions={libraryTypeOptions}
      selectableLibraryTypeOptions={selectableLibraryTypeOptions}
      canAddLibraries={canManageLibraries}
      canReorderLibraries={canManageLibraries}
      canChangeLibraryType={canManageLibraries}
      canEditLibraryDetails={canManageLibraries}
      canRemoveLibrary={(library) =>
        canRemoveProjectLibrary(library, { canManageLibraries })
      }
    />
  )
}
