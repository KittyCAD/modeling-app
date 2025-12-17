import {
  runningOnLinux,
  runningOnMac,
  runningOnWindows,
} from '@e2e/playwright/test-utils'

describe('platform detection utilities', () => {
  const originalPlatform = process.platform

  afterAll(() => {
    Object.defineProperty(process, 'platform', {
      value: originalPlatform,
    })
  })

  describe('runningOnLinux', () => {
    it('returns true on Linux', () => {
      Object.defineProperty(process, 'platform', {
        value: 'linux',
      })
      expect(runningOnLinux()).toBe(true)
    })

    it('returns false on other platforms', () => {
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
      })
      expect(runningOnLinux()).toBe(false)
    })
  })

  describe('runningOnMac', () => {
    it('returns true on Mac', () => {
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
      })
      expect(runningOnMac()).toBe(true)
    })

    it('returns false on other platforms', () => {
      Object.defineProperty(process, 'platform', {
        value: 'linux',
      })
      expect(runningOnMac()).toBe(false)
    })
  })

  describe('runningOnWindows', () => {
    it('returns true on Windows', () => {
      Object.defineProperty(process, 'platform', {
        value: 'win32',
      })
      expect(runningOnWindows()).toBe(true)
    })

    it('returns false on other platforms', () => {
      Object.defineProperty(process, 'platform', {
        value: 'linux',
      })
      expect(runningOnWindows()).toBe(false)
    })
  })
})
