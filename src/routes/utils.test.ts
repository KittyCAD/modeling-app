import { getAppVersion, getRefFromVersion } from '@src/routes/utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

beforeEach(()=>{
      const mockElectron = {
        packageJson: {
          version: 'mocked-version'
        }
      }
      vi.stubGlobal('window', { electron: mockElectron })
})

afterEach(() =>{
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
    it('should return 0.0.0', () => {
      const expected = '0.0.0'
      const actual = getAppVersion({
        isTestEnvironment: true,
        NODE_ENV: 'development',
        isDesktop: false
      })
      expect(actual).toBe(expected)
    })
    it('should return another 0.0.0', () => {
      const expected = '0.0.0'
      const actual = getAppVersion({
        isTestEnvironment: true,
        NODE_ENV: 'development',
        isDesktop: true
      })
      expect(actual).toBe(expected)
    })
    it('should return another mocked packageJson version', ()=>{
      const expected = 'mocked-version'
      const actual = getAppVersion({
        isTestEnvironment: false,
        NODE_ENV: 'development',
        isDesktop: true
      })
      expect(actual).toBe(expected)
    })
    it('should return another mocked packageJson version', ()=>{
      const expected = 'mocked-version'
      const actual = getAppVersion({
        isTestEnvironment: true,
        NODE_ENV: 'not-development',
        isDesktop: true
      })
      expect(actual).toBe(expected)
    })
    it('should return main/development', () => {
      const expected = 'main/development'
      const actual = getAppVersion({
        isTestEnvironment: false,
        NODE_ENV: 'development',
        isDesktop: false
      })
      expect(actual).toBe(expected)
    })
    it('should return main', () => {
      const expected = 'main'
      const actual = getAppVersion({
        isTestEnvironment: false,
        NODE_ENV: 'not-development',
        isDesktop: false
      })
      expect(actual).toBe(expected)
    })
    it('should return main beacuse NODE_ENV is production', () => {
      const expected = 'main'
      const actual = getAppVersion({
        isTestEnvironment: false,
        NODE_ENV: 'production',
        isDesktop: false
      })
      expect(actual).toBe(expected)
    })
  })
})
