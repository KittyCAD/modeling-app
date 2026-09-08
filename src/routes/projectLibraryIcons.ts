import type { CustomIconName } from '@src/components/CustomIcon'
import type { ProjectLibrary } from '@src/lib/projectLibraries'

export function getProjectLibraryIconName(
  library: Pick<ProjectLibrary, 'icon' | 'type'>
): CustomIconName {
  if (library.type === 'cloud' || library.icon === 'cloud') {
    return 'cloud'
  }

  if (library.icon === 'network') {
    return 'network'
  }

  return 'folder'
}
