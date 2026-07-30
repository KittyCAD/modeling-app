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

  return normalized || fallback
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
