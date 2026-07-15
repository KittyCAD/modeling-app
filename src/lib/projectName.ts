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
