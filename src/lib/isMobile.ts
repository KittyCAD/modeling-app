const MOBILE_USER_AGENT_REGEX = /android|iphone|ipad|ipod|iemobile|blackberry|opera mini|mobile/i

// Determine if the current runtime is a mobile browser (non-Electron).
export function isMobile(): boolean {
  if (typeof navigator === 'undefined') return false

  const nav = navigator as Navigator & {
    userAgentData?: { mobile?: boolean }
  }

  // Prefer the modern userAgentData flag when available.
  if (typeof nav.userAgentData?.mobile === 'boolean') {
    return nav.userAgentData.mobile
  }

  const userAgent = (navigator.userAgent || '').toLowerCase()
  const vendor = (navigator.vendor || '').toLowerCase()

  return (
    MOBILE_USER_AGENT_REGEX.test(userAgent) ||
    MOBILE_USER_AGENT_REGEX.test(vendor)
  )
}
