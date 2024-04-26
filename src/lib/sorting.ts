import {
  faArrowDown,
  faArrowUp,
  faCircle,
} from '@fortawesome/free-solid-svg-icons'
import { Project } from 'wasm-lib/kcl/bindings/Project'

const DESC = ':desc'

export function getSortIcon(currentSort: string, newSort: string) {
  if (currentSort === newSort) {
    return faArrowUp
  } else if (currentSort === newSort + DESC) {
    return faArrowDown
  }
  return faCircle
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
