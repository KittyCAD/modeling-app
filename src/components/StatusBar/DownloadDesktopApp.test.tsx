import { describe, expect, test } from 'vitest'

import { shouldShowBrowserStorageWarning } from '@src/components/StatusBar/downloadDesktopAppPolicy'

describe('DownloadDesktopApp', () => {
  test('hides the browser storage warning when OPFS cloud is enabled', () => {
    expect(shouldShowBrowserStorageWarning(false)).toBe(true)
    expect(shouldShowBrowserStorageWarning(true)).toBe(false)
  })
})
