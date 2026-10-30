export function isImageMimetype(mimetype: string): boolean {
  return mimetype.startsWith('image/')
}

export function isTextMimetype(mimetype: string): boolean {
  const type = mimetype.split(';')[0].trim().toLowerCase()
  return (
    type.startsWith('text/') ||
    type.endsWith('+json') ||
    type.endsWith('+xml') ||
    [
      'application/json',
      'application/xml',
      'application/javascript',
      'application/yaml',
      'application/x-yaml',
      'application/toml',
      'application/x-ndjson',
    ].includes(type)
  )
}
