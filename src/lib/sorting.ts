import type { CustomIconName } from '@src/components/CustomIcon'
import type { Project } from '@src/lib/project'

const DESC = ':desc'

export function getSortIcon(
  currentSort: string,
  newSort: string
): CustomIconName {
  if (currentSort === newSort) {
    return 'arrowUp'
  } else if (currentSort === newSort + DESC) {
    return 'arrowDown'
  }
  return 'horizontalDash'
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
  const sortByName = (a: Project, b: Project) => {
    if (a.name && b.name) {
      return sortBy.includes('desc')
        ? a.name.localeCompare(b.name)
        : b.name.localeCompare(a.name)
    }
    return 0
  }

  const sortByModified = (a: Project, b: Project) => {
    const aModified =
      a.last_opened_at ?? a.metadata?.modified ?? Number.NEGATIVE_INFINITY
    const bModified =
      b.last_opened_at ?? b.metadata?.modified ?? Number.NEGATIVE_INFINITY
    const modifiedComparison =
      !sortBy || sortBy.includes('desc')
        ? bModified - aModified
        : aModified - bModified
    if (!Number.isNaN(modifiedComparison) && modifiedComparison !== 0) {
      return modifiedComparison
    }

    return (a.name ?? '').localeCompare(b.name ?? '')
  }

  if (sortBy?.includes('name')) {
    return sortByName
  } else {
    return sortByModified
  }
}
