import { ZOO_DOMAIN_STAGING, ZOO_DOMAIN_PRODUCTION } from '@src/lib/constants'

const LOCAL_HOSTNAMES = ['localhost', '127.0.0.1', '0.0.0.0']

export function getEnvironmentLabel(
  domain: string | undefined,
  urls: URL[]
): string | undefined {
  let label = domain
  for (const url of urls) {
    if (LOCAL_HOSTNAMES.includes(url.hostname)) {
      label = `${label} + local`
    } else if (url.search) {
      label = `${label} + ${url.search.substring(1)}`
    }
  }
  return label
}

export function isNonStandardEnvironment(
  environmentLabel: string | undefined,
  productionApp: boolean
): boolean {
  if (!environmentLabel) {
    return false
  }
  if (environmentLabel.includes('+')) {
    return true
  }
  if (productionApp && environmentLabel === ZOO_DOMAIN_STAGING) {
    return true
  }
  if (!productionApp && environmentLabel === ZOO_DOMAIN_PRODUCTION) {
    return true
  }
  return false
}
