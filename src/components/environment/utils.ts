export function getEnvironmentLabel(
  domain: string | undefined,
  urls: URL[]
): string | undefined {
  let label = domain
  for (const url of urls) {
    if (['localhost', '127.0.0.1', '0.0.0.0'].includes(url.hostname)) {
      label = `${label} + local`
    } else if (url.search) {
      label = `${label} + ${url.search.substring(1)}`
    }
  }
  return label
}

export function isNonStandardEnvironment(
  label: string | undefined,
  production: boolean
): boolean {
  if (!label) {
    return false
  }
  if (label.includes('+')) {
    return true
  }
  if (!production && label === 'zoo.dev') {
    return true
  }
  if (production && label === 'dev.zoo.dev') {
    return true
  }
  return false
}
