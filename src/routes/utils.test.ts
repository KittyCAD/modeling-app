import { getAppVersion, getRefFromVersion } from '@src/routes/utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

beforeEach(() => {
  const mockElectron = {
    packageJson: {
      version: 'mocked-version',
    },
  }
  vi.stubGlobal('window', { electron: mockElectron })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Routes utility functions', () => {
  describe('getRefFromVersion', () => {
    it('returns the short commit sha on staging version', () => {
      expect(getRefFromVersion('25.6.17-main.fe581ff')).toBe('fe581ff')
    })
    it('returns undefined on non-staging version', () => {
      expect(getRefFromVersion('1.0.5')).toBeUndefined()
    })
    it('returns undefined on debug version', () => {
      expect(getRefFromVersion('main')).toBeUndefined()
    })
  })

  describe('getAppVersion', () => {
    it('returns the Electron package version', () => {
      const actual = getAppVersion({
        isDesktop: true,
        vercelReleaseTag: undefined,
        vercelGitCommitSha: undefined,
      })
      expect(actual).toBe('mocked-version')
    })

    it('returns the release version injected into a Vercel production build', () => {
      const actual = getAppVersion({
        isDesktop: false,
        vercelReleaseTag: 'v1.2.3',
        vercelGitCommitSha: 'abcdef1234567890',
      })
      expect(actual).toBe('1.2.3')
    })

    it('returns the short commit SHA for Vercel deployments', () => {
      const actual = getAppVersion({
        isDesktop: false,
        vercelReleaseTag: undefined,
        vercelGitCommitSha: 'fe581ff1234567890',
      })
      expect(actual).toBe('fe581ff')
    })

    it.each([undefined, '', 'short'])(
      'returns 0.0.0 when Vercel metadata is unavailable (%s)',
      (vercelGitCommitSha) => {
        const actual = getAppVersion({
          isDesktop: false,
          vercelReleaseTag: undefined,
          vercelGitCommitSha,
        })
        expect(actual).toBe('0.0.0')
      }
    )
  })
})
