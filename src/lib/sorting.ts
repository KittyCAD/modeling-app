import type { CustomIconName } from '@src/components/CustomIcon'
import type { Project } from '@src/lib/project'
import type { IResponseMlConversation } from '@src/lib/textToCad'

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

export function getProjectSortFunction(sortBy: string) {
  const sortByName = (a: Project, b: Project) => {
    if (a.name && b.name) {
      return sortBy.includes('desc')
        ? a.name.localeCompare(b.name)
        : b.name.localeCompare(a.name)
    }
    return 0
  }

  const sortByModified = (a: Project, b: Project) => {
    if (a.metadata?.modified && b.metadata?.modified) {
      const aDate = new Date(a.metadata.modified)
      const bDate = new Date(b.metadata.modified)
      return !sortBy || sortBy.includes('desc')
        ? bDate.getTime() - aDate.getTime()
        : aDate.getTime() - bDate.getTime()
    }
    return 0
  }

  if (sortBy?.includes('name')) {
    return sortByName
  } else {
    return sortByModified
  }
}

// Below is to keep the same behavior as above but for converstions.
// Do NOT take it as actually "sort by modified" but more like "sort by time".
export function getConvoSortFunction(sortBy: string) {
  const sortByName = (
    a: IResponseMlConversation,
    b: IResponseMlConversation
  ) => {
    if (a.first_prompt && b.first_prompt) {
      return sortBy.includes('desc')
        ? a.first_prompt.localeCompare(b.first_prompt)
        : b.first_prompt.localeCompare(a.first_prompt)
    }
    return 0
  }

  const sortByModified = (
    a: IResponseMlConversation,
    b: IResponseMlConversation
  ) => {
    if (a.created_at && b.created_at) {
      // INTENTIONALLY REVERSED
      // Will not show properly otherwise.
      const aDate = new Date(b.created_at)
      const bDate = new Date(a.created_at)
      return !sortBy || sortBy.includes('desc')
        ? bDate.getTime() - aDate.getTime()
        : aDate.getTime() - bDate.getTime()
    }
    return 0
  }

  if (sortBy?.includes('name')) {
    return sortByName
  } else {
    return sortByModified
  }
}
