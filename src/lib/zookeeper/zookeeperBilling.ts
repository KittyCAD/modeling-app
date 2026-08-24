export const ZOOKEEPER_ACCESS_DENIAL_CODES = [
  'missing_payment_method',
  'payment_method_failed',
  'billing_threshold_reached',
  'pay_as_you_go_disabled',
  'upgrade_downgrade_abuse',
  'admin',
] as const

export type ZookeeperAccessDenialCode =
  (typeof ZOOKEEPER_ACCESS_DENIAL_CODES)[number]

export type ZookeeperAccessDeniedMessage = {
  access_denied: {
    code: ZookeeperAccessDenialCode
    detail: string
    retryable: boolean
  }
}

const LEGACY_BILLING_ERROR_MARKERS = [
  'no api credits available',
  'enable pay as you go',
  '/account/billing',
]

const LEGACY_CODE_MARKERS: ReadonlyArray<
  readonly [ZookeeperAccessDenialCode, readonly string[]]
> = [
  ['payment_method_failed', ['payment method failed', 'payment failed']],
  [
    'missing_payment_method',
    ['missing payment method', 'add a payment method'],
  ],
  [
    'billing_threshold_reached',
    ['billing threshold', 'outstanding invoice', 'pay your invoice'],
  ],
  ['upgrade_downgrade_abuse', ['upgrade and downgrade', 'upgrade/downgrade']],
  ['admin', ['administrative block', 'contact support']],
  [
    'pay_as_you_go_disabled',
    ['no api credits available', 'enable pay as you go'],
  ],
]

export function isZookeeperAccessDenialCode(
  code: unknown
): code is ZookeeperAccessDenialCode {
  return (
    typeof code === 'string' &&
    ZOOKEEPER_ACCESS_DENIAL_CODES.some((candidate) => candidate === code)
  )
}

export function parseZookeeperAccessDeniedMessage(
  response: unknown
): ZookeeperAccessDeniedMessage['access_denied'] | undefined {
  if (
    typeof response !== 'object' ||
    response === null ||
    !('access_denied' in response) ||
    typeof response.access_denied !== 'object' ||
    response.access_denied === null
  ) {
    return undefined
  }

  const denial = response.access_denied
  if (
    !('code' in denial) ||
    !isZookeeperAccessDenialCode(denial.code) ||
    !('detail' in denial) ||
    typeof denial.detail !== 'string' ||
    !('retryable' in denial) ||
    typeof denial.retryable !== 'boolean'
  ) {
    return undefined
  }

  return {
    code: denial.code,
    detail: denial.detail,
    retryable: denial.retryable,
  }
}

export function getZookeeperAccessDenialCode(
  message?: string
): ZookeeperAccessDenialCode | undefined {
  if (!message) {
    return undefined
  }

  const normalizedMessage = message.toLowerCase()
  return LEGACY_CODE_MARKERS.find(([, markers]) =>
    markers.some((marker) => normalizedMessage.includes(marker))
  )?.[0]
}

export function isZookeeperBillingError(message?: string): boolean {
  if (!message) {
    return false
  }

  const normalizedMessage = message.toLowerCase()
  return (
    getZookeeperAccessDenialCode(message) !== undefined ||
    LEGACY_BILLING_ERROR_MARKERS.some((marker) =>
      normalizedMessage.includes(marker)
    )
  )
}
