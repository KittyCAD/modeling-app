import type { CustomIconName } from '@src/components/CustomIcon'

const DESC = ':desc'

type SortableProject = {
  name?: string
  title?: string
  modified?: number | null
  metadata?: {
    modified?: number | null
  } | null
}

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
  if (currentSort === null || !currentSort) {
    return { sort_by: newSort + (newSort !== 'modified' ? DESC : '') }
  }
  if (currentSort.includes(newSort) && !currentSort.includes(DESC)) {
    return { sort_by: '' }
  }
  return {
    sort_by: newSort + (currentSort.includes(DESC) ? '' : DESC),
  }
}

function getSortableProjectName(project: SortableProject) {
  return project.title?.trim() || project.name || 'project'
}

function getSortableProjectModified(project: SortableProject) {
  return (
    project.modified ?? project.metadata?.modified ?? Number.NEGATIVE_INFINITY
  )
}

export function getSortFunction<T extends SortableProject>(sortBy: string) {
  const sortByName = (a: T, b: T) => {
    const aName = getSortableProjectName(a)
    const bName = getSortableProjectName(b)
    return sortBy.includes('desc')
      ? aName.localeCompare(bName)
      : bName.localeCompare(aName)
  }

  const sortByModified = (a: T, b: T) => {
    const aModified = getSortableProjectModified(a)
    const bModified = getSortableProjectModified(b)
    const modifiedComparison =
      !sortBy || sortBy.includes('desc')
        ? bModified - aModified
        : aModified - bModified
    if (!Number.isNaN(modifiedComparison) && modifiedComparison !== 0) {
      return modifiedComparison
    }

    return getSortableProjectName(a).localeCompare(getSortableProjectName(b))
  }

  if (sortBy?.includes('name')) {
    return sortByName
  } else {
    return sortByModified
  }
}
