export const VERCEL_AUTOMATION_BYPASS_SECRET_ENV =
  'VERCEL_AUTOMATION_BYPASS_SECRET'
export const VERCEL_VISITOR_PASSWORD_ENV = 'VERCEL_VISITOR_PASSWORD'

function isVercelPreviewUrl(url: string | undefined) {
  if (!url) {
    return false
  }

  try {
    const hostname = new URL(url).hostname
    return (
      hostname.endsWith('vercel.dev.zoo.dev') ||
      hostname === 'dev.zoo.dev' ||
      hostname.endsWith('.dev.zoo.dev')
    )
  } catch {
    return false
  }
}

export function shouldUseVercelVisitorPasswordFallback(
  env: Record<string, string | undefined> = process.env
) {
  return Boolean(
    isVercelPreviewUrl(env.VERCEL_BASE_URL) &&
      env[VERCEL_VISITOR_PASSWORD_ENV] &&
      !env[VERCEL_AUTOMATION_BYPASS_SECRET_ENV]
  )
}
