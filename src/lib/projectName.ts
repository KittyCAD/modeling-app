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
