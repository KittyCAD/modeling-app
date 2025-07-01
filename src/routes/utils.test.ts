import { getRefFromVersion } from '@src/routes/utils'

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
})
