export function sanitizeProjectName(name: string, fallback: string) {
  const sanitize = (value: string) =>
    value
      .trim()
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
      .replace(/^\.+/, '')
      .replace(/[. ]+$/, '')
      .trim()

  const sanitized = sanitize(name) || sanitize(fallback) || 'untitled'
  const windowsDeviceName = sanitized.match(
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i
  )
  return windowsDeviceName
    ? `${windowsDeviceName[1]}-project${windowsDeviceName[2] ?? ''}`
    : sanitized
}
