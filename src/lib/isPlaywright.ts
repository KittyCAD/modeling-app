import { IS_PLAYWRIGHT_KEY } from '@src/lib/constants'

export function isPlaywright(): boolean {
  // ? checks for browser
  const electronRunTimePlaywright =
    window?.electron?.process?.env.IS_PLAYWRIGHT == 'true'
  const browserRuntimePlaywright =
    localStorage.getItem(IS_PLAYWRIGHT_KEY) === 'true'
  return electronRunTimePlaywright || browserRuntimePlaywright
}
