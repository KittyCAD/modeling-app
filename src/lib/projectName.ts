import { INDEX_IDENTIFIER, MAX_PADDING } from '@src/lib/constants'

export function sanitizeProjectName(name: string, fallback: string) {
  const sanitized = name.trim().replace(/[\\/]/g, '-')
  return sanitized || fallback
}

export function getProjectDirectoryNameFromTitle(
  title: string,
  fallback: string
) {
  const normalized = title
    .trim()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  const directoryName = normalized || fallback
  // These device names are reserved even when used as directories on Windows.
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(directoryName)
    ? `project-${directoryName}`
    : directoryName
}

export function getProjectTitleFromUniqueDirectoryName({
  requestedProjectTitle,
  requestedProjectDirectoryName,
  uniqueProjectDirectoryName,
}: {
  requestedProjectTitle: string
  requestedProjectDirectoryName: string
  uniqueProjectDirectoryName: string
}) {
  if (uniqueProjectDirectoryName === requestedProjectDirectoryName) {
    return requestedProjectTitle
  }

  if (
    !uniqueProjectDirectoryName.startsWith(`${requestedProjectDirectoryName}-`)
  ) {
    return requestedProjectTitle
  }

  return `${requestedProjectTitle}${uniqueProjectDirectoryName.slice(
    requestedProjectDirectoryName.length
  )}`
}

export function getUniqueProjectNameFromExistingNames(
  name: string,
  existingNames: readonly string[]
) {
  const names = new Set(existingNames.map((entry) => entry.toLowerCase()))
  let uniqueName = name
  while (names.has(uniqueName.toLowerCase())) {
    const nameEndsWithNumber = uniqueName.match(/\d+$/)
    uniqueName = nameEndsWithNumber
      ? uniqueName.replace(/\d+$/, (num) => `${parseInt(num, 10) + 1}`)
      : `${name}-1`
  }
  return uniqueName
}

export function getUniqueDuplicateProjectName(
  sourceName: string,
  existingProjectNames: readonly string[]
) {
  return getUniqueProjectNameFromExistingNames(
    `${sourceName}-copy`,
    existingProjectNames
  )
}

// create a regex to match the project name
// replacing any instances of "$n" with a regex to match any number
function interpolateProjectName(projectName: string) {
  const regex = new RegExp(
    projectName.replace(getPaddedIdentifierRegExp(), '([0-9]+)')
  )
  return regex
}

export function getNextProjectIndexFromNames(
  projectName: string,
  existingNames: readonly string[]
) {
  const regex = interpolateProjectName(projectName)
  const matches = existingNames.map((name) => name.match(regex))
  const indices = matches
    .filter(Boolean)
    .map((match) => (match !== null ? match[1] : '-1'))
    .map((maybeMatchIndex) => {
      return parseInt(maybeMatchIndex || '0', 10)
    })
  const maxIndex = Math.max(...indices, -1)
  return maxIndex + 1
}

// Interpolates the project name with the next available index,
// padding the index with 0s if necessary
export function interpolateProjectNameWithIndex(
  projectName: string,
  index: number
) {
  const regex = getPaddedIdentifierRegExp()

  const matches = projectName.match(regex)
  const padStartLength = Math.min(
    matches !== null ? matches[1]?.length || 0 : 0,
    MAX_PADDING
  )
  return projectName.replace(
    regex,
    index.toString().padStart(padStartLength + 1, '0')
  )
}

export function doesProjectNameNeedInterpolated(projectName: string) {
  return projectName.includes(INDEX_IDENTIFIER)
}

export function getUniqueProjectNameFromNames(
  name: string,
  existingNames: readonly string[]
) {
  if (doesProjectNameNeedInterpolated(name)) {
    const nextIndex = getNextProjectIndexFromNames(name, existingNames)
    return interpolateProjectNameWithIndex(name, nextIndex)
  }

  return getUniqueProjectNameFromExistingNames(name, existingNames)
}

function escapeRegExpChars(string: string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function getPaddedIdentifierRegExp() {
  const escapedIdentifier = escapeRegExpChars(INDEX_IDENTIFIER)
  return new RegExp(`${escapedIdentifier}(${escapedIdentifier.slice(-1)}*)`)
}
