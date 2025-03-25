import {
  runningOnLinux,
  runningOnMac,
  runningOnWindows,
  orRunWhenFullSuiteEnabled,
} from './test-utils'

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

describe('utility to bypass unreliable tests', () => {
  const originalEnv = { ...process.env }

  afterAll(() => {
    process.env = { ...originalEnv }
  })
  it('always runs them on dedicated branch', () => {
    process.env.GITHUB_EVENT_NAME = 'push'
    process.env.GITHUB_REF = 'refs/heads/all-e2e'
    process.env.GITHUB_HEAD_REF = ''
    process.env.GITHUB_BASE_REF = ''
    const condition = orRunWhenFullSuiteEnabled()
    expect(condition).toBe(false)
  })
  it('skips them on the main branch', () => {
    process.env.GITHUB_EVENT_NAME = 'push'
    process.env.GITHUB_REF = 'refs/heads/main'
    process.env.GITHUB_HEAD_REF = ''
    process.env.GITHUB_BASE_REF = ''
    const condition = orRunWhenFullSuiteEnabled()
    expect(condition).toBe(true)
  })
  it('skips them on pull requests', () => {
    process.env.GITHUB_EVENT_NAME = 'pull_request'
    process.env.GITHUB_REF = 'refs/pull/5883/merge'
    process.env.GITHUB_HEAD_REF = 'my-branch'
    process.env.GITHUB_BASE_REF = 'main'
    const condition = orRunWhenFullSuiteEnabled()
    expect(condition).toBe(true)
  })
})
