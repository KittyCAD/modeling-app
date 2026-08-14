export function formatDateTime(dateTimeMs: number | undefined) {
  if (dateTimeMs === undefined || Number.isNaN(dateTimeMs)) {
    return 'Unknown'
  }

  return new Date(dateTimeMs).toLocaleString()
}

export function formatOptionalDateTime(dateTime: string | undefined) {
  if (!dateTime) {
    return undefined
  }

  const parsed = Date.parse(dateTime)
  return Number.isNaN(parsed) ? undefined : formatDateTime(parsed)
}
