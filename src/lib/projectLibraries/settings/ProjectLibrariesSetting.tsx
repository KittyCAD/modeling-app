import { isDesktop } from '@src/lib/isDesktop'
import { PATHS } from '@src/lib/paths'
import {
  DIRECTORY_PROJECT_LIBRARY_TYPE,
  type ProjectLibrarySetting,
} from '@src/lib/projectLibraries'
import { ProjectLibrariesSettingInput } from '@src/lib/projectLibraries/settings/ProjectLibrariesSettingInput'
import type { SettingComponentProps } from '@src/lib/settings/settingsTypes'
import { useMemo } from 'react'
import { Link } from 'react-router-dom'

export function ProjectLibrariesSetting({
  value,
  updateValue,
}: Pick<
  SettingComponentProps<ProjectLibrarySetting[]>,
  'value' | 'updateValue'
>) {
  const localLibraries = useMemo(
    () =>
      value.filter(
        (library) => library.type === DIRECTORY_PROJECT_LIBRARY_TYPE
      ),
    [value]
  )

  return (
    <div className="flex flex-col items-start gap-2">
      <ProjectLibrariesSettingInput
        value={localLibraries}
        updateValue={(libraries) =>
          updateValue([
            ...libraries,
            ...value.filter(
              (library) => library.type !== DIRECTORY_PROJECT_LIBRARY_TYPE
            ),
          ])
        }
        canManageLibraries={isDesktop()}
      />
      <Link to={PATHS.HOME} className="text-sm text-2 underline">
        Manage other libraries on Home.
      </Link>
    </div>
  )
}
