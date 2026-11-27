import { useSignals } from '@preact/signals-react/runtime'
import { isDesktop } from '@src/lib/isDesktop'
import { PATHS } from '@src/lib/paths'
import {
  DIRECTORY_PROJECT_LIBRARY_TYPE,
  type ProjectLibrarySetting,
} from '@src/lib/projectLibraries'
import { DirectoryLibrarySettingInput } from '@src/lib/projectLibraries/settings/DirectoryLibrarySettingInput'
import type { SettingComponentProps } from '@src/lib/settings/settingsTypes'
import { projectLibraryTypesFacet } from '@src/registry/contracts/projectLibraries'
import { useMemo } from 'react'
import { Link } from 'react-router-dom'

export function DirectoryLibrarySetting({
  value,
  updateValue,
  registry,
}: Pick<
  SettingComponentProps<ProjectLibrarySetting[]>,
  'value' | 'updateValue' | 'registry'
>) {
  useSignals()
  const canManageLibraries = isDesktop()
  const directoryType = registry
    .observe(projectLibraryTypesFacet)
    .value.get(DIRECTORY_PROJECT_LIBRARY_TYPE)
  const localLibraries = useMemo(
    () =>
      value.filter(
        (library) => library.type === DIRECTORY_PROJECT_LIBRARY_TYPE
      ),
    [value]
  )

  return (
    <div className="flex flex-col items-start gap-2">
      <DirectoryLibrarySettingInput
        value={localLibraries}
        updateValue={(libraries) =>
          updateValue([
            ...libraries,
            ...value.filter(
              (library) => library.type !== DIRECTORY_PROJECT_LIBRARY_TYPE
            ),
          ])
        }
        directoryType={directoryType}
        canAddLibraries={canManageLibraries}
        canReorderLibraries={canManageLibraries}
        canEditLibraryDetails={canManageLibraries}
      />
      <Link to={PATHS.HOME} className="text-sm text-2 underline">
        Manage other libraries on Home.
      </Link>
    </div>
  )
}
