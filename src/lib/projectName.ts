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
      ? uniqueName.replace(/\d+$/, (num) => (BigInt(num) + 1n).toString())
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
  const identifier = getPaddedIdentifierRegExp().exec(projectName)
  const pattern = identifier
    ? `${escapeRegExpChars(projectName.slice(0, identifier.index))}([0-9]+)${escapeRegExpChars(projectName.slice(identifier.index + identifier[0].length))}`
    : escapeRegExpChars(projectName)
  return new RegExp(`^${pattern}$`, 'i')
}

export function getNextProjectIndexFromNames(
  projectName: string,
  existingNames: readonly string[]
) {
  const regex = interpolateProjectName(projectName)
  let nextIndex = 0n
  for (const name of existingNames) {
    const match = regex.exec(name)
    if (!match) continue
    const index = BigInt(match[1] || '0')
    if (index >= nextIndex) nextIndex = index + 1n
  }
  return nextIndex <= BigInt(Number.MAX_SAFE_INTEGER)
    ? Number(nextIndex)
    : nextIndex
}

// Interpolates the project name with the next available index,
// padding the index with 0s if necessary
export function interpolateProjectNameWithIndex(
  projectName: string,
  index: number | bigint
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
