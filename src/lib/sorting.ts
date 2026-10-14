import type { CustomIconName } from '@src/components/CustomIcon'

const DESC = ':desc'

/** Supported project-list sorting choices, including the default reset choice. */
export type ProjectSort =
  | ''
  | 'name'
  | 'name:desc'
  | 'modified'
  | 'modified:desc'
export type ProjectSortField = 'name' | 'modified'
export const DEFAULT_PROJECT_SORT: ProjectSort = 'modified:desc'

export function parseProjectSort(value: string): ProjectSort {
  switch (value) {
    case '':
    case 'name':
    case 'name:desc':
    case 'modified':
    case 'modified:desc':
      return value
    default:
      return DEFAULT_PROJECT_SORT
  }
}

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

export function getNextProjectSort(
  currentSort: ProjectSort,
  newSort: ProjectSortField
): ProjectSort {
  if (!currentSort) {
    return newSort === 'modified' ? 'modified' : 'name:desc'
  }
  if (currentSort.includes(newSort) && !currentSort.includes(DESC)) {
    return ''
  }
  return currentSort.includes(DESC) ? newSort : `${newSort}:desc`
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
