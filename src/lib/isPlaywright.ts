import { IS_PLAYWRIGHT_KEY } from '@e2e/playwright/storageStates'
export function isPlaywright(): boolean {
  // ? checks for browser
  const electronRunTimePlaywright =
    window?.electron?.process?.env.IS_PLAYWRIGHT == 'true'
  const browserRuntimePlaywright =
    localStorage.getItem(IS_PLAYWRIGHT_KEY) === 'true'
  return electronRunTimePlaywright || browserRuntimePlaywright
}
