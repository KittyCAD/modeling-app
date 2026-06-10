const allowedExternalUrlProtocols = new Set(['https:', 'http:'])

export function getAllowedExternalURL(url: unknown): string | Error {
  if (typeof url !== 'string') {
    return new Error('External URL must be a string')
  }

  let parsedURL: URL
  try {
    parsedURL = new URL(url)
  } catch {
    return new Error('External URL must be absolute')
  }

  if (!allowedExternalUrlProtocols.has(parsedURL.protocol)) {
    return new Error(
      `External URL protocol is not allowed: ${parsedURL.protocol}`
    )
  }

  return parsedURL.href
}
