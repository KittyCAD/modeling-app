export function sanitizeProjectName(name: string, fallback: string) {
  const sanitized = name.trim().replace(/[\\/]/g, '-')
  return sanitized || fallback
}
