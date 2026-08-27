import type { IconName } from '@kittycad/ui-kit'
import type { ProjectLibraryTypeContribution } from '@src/contracts/projectLibraries'
import type { ProjectLibrary } from '@src/lib/projectLibraries'

/**
 * The icon for a library.
 *
 * Comes from its type, falling back to a folder for a library whose type is not
 * installed — which happens when a plugin that registered it is turned off, and
 * should look inert rather than broken.
 */
export function libraryIcon(
  library: ProjectLibrary,
  type: ProjectLibraryTypeContribution | undefined
): IconName {
  return type?.icon ?? 'folder'
}
