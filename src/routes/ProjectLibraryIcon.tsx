import { CustomIcon } from '@src/components/CustomIcon'
import { useIsGitWorkingCopy } from '@src/hooks/useGitWorkingCopy'
import type { ProjectLibrary } from '@src/lib/projectLibraries'
import { getProjectLibraryIconName } from '@src/routes/projectLibraryIcons'
import type { HTMLProps } from 'react'

interface ProjectLibraryIconProps extends HTMLProps<HTMLDivElement> {
  library: Pick<ProjectLibrary, 'icon' | 'path' | 'type'>
  iconClassName?: string
}

/**
 * Icon for a project library, showing a git glyph in place of the folder when
 * the library folder is inside a git working copy.
 */
export function ProjectLibraryIcon({
  library,
  className = '',
  iconClassName = 'h-5 w-5',
  children,
  ...rest
}: ProjectLibraryIconProps) {
  const iconName = getProjectLibraryIconName(library)
  const isGitWorkingCopy = useIsGitWorkingCopy(
    iconName === 'folder' ? library.path : undefined
  )

  return (
    <div
      className={`relative grid place-content-center ${className}`}
      {...rest}
    >
      {isGitWorkingCopy ? (
        <CustomIcon
          name="git"
          className={iconClassName}
          role="img"
          aria-label="Git working copy"
        />
      ) : (
        <CustomIcon
          name={iconName}
          className={iconClassName}
          aria-hidden="true"
        />
      )}
      {children}
    </div>
  )
}
