import {
  faArrowDown,
  faArrowUp,
  faCircleDot,
} from '@fortawesome/free-solid-svg-icons'
import { ProjectWithEntryPointMetadata } from '../Router'

const DESC = ':desc'

export function getSortIcon(currentSort: string, newSort: string) {
  if (currentSort === newSort) {
    return faArrowUp
  } else if (currentSort === newSort + DESC) {
    return faArrowDown
  }
  return faCircleDot
}

export function getNextSearchParams(currentSort: string, newSort: string) {
  if (currentSort === null || !currentSort)
    return { sort_by: newSort + (newSort !== 'modified' ? DESC : '') }
  if (currentSort.includes(newSort) && !currentSort.includes(DESC))
    return { sort_by: '' }
  return {
    sort_by: newSort + (currentSort.includes(DESC) ? '' : DESC),
  }
}

export function getSortFunction(sortBy: string) {
  const sortByName = (
    a: ProjectWithEntryPointMetadata,
    b: ProjectWithEntryPointMetadata
  ) => {
    if (a.name && b.name) {
      return sortBy.includes('desc')
        ? a.name.localeCompare(b.name)
        : b.name.localeCompare(a.name)
    }
    return 0
  }

  const sortByModified = (
    a: ProjectWithEntryPointMetadata,
    b: ProjectWithEntryPointMetadata
  ) => {
    if (
      a.entrypointMetadata?.modifiedAt &&
      b.entrypointMetadata?.modifiedAt
    ) {
      return !sortBy || sortBy.includes('desc')
        ? b.entrypointMetadata.modifiedAt.getTime() -
            a.entrypointMetadata.modifiedAt.getTime()
        : a.entrypointMetadata.modifiedAt.getTime() -
            b.entrypointMetadata.modifiedAt.getTime()
    }
    return 0
  }

  if (sortBy?.includes('name')) {
    return sortByName
  } else {
    return sortByModified
  }
}
