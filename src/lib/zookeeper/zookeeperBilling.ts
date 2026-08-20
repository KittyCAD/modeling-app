const ZOOKEEPER_BILLING_ERROR_MARKERS = [
  'no api credits available',
  'enable pay as you go',
  '/account/billing',
]

export function isZookeeperBillingError(message?: string): boolean {
  if (!message) {
    return false
  }

  const normalizedMessage = message.toLowerCase()
  return ZOOKEEPER_BILLING_ERROR_MARKERS.some((marker) =>
    normalizedMessage.includes(marker)
  )
}
