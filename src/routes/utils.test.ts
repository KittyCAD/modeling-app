import {
  getAppVersion,
  getRefFromVersion,
  getReleaseUrl,
} from '@src/routes/utils'
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

  it('links a short commit SHA to its GitHub commit', () => {
    expect(getReleaseUrl('fe581ff')).toBe(
      'https://github.com/KittyCAD/modeling-app/commit/fe581ff'
    )
  })

  describe('getAppVersion', () => {
    it('returns the Electron package version', () => {
      const actual = getAppVersion({
        gitCommitSha: undefined,
        isDesktop: true,
      })
      expect(actual).toBe('mocked-version')
    })

    it('returns the short commit SHA for web builds', () => {
      const actual = getAppVersion({
        gitCommitSha: 'fe581ff1234567890',
        isDesktop: false,
      })
      expect(actual).toBe('fe581ff')
    })

    it.each([undefined, '', 'short'])(
      'returns no web version when commit metadata is unavailable (%s)',
      (gitCommitSha) => {
        const actual = getAppVersion({
          gitCommitSha,
          isDesktop: false,
        })
        expect(actual).toBeUndefined()
      }
    )
  })
})
