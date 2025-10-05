import { LayoutType } from '@src/lib/layout/types'
import { validateSimpleLayout } from '@src/lib/layout/utils'

describe('Layout utils', () => {
  describe('Layout validation', () => {
    it('should catch bad simple layouts', () => {
      const missingAreaType = {
        id: 'bad-layout',
        label: 'bad',
        type: LayoutType.Simple,
      }
      const missingLabel = {
        id: 'bad-layout',
        type: LayoutType.Simple,
        areaType: 'code',
      }
      const validLayout = {
        id: 'good-layout',
        label: 'Good',
        type: LayoutType.Simple,
        areaType: 'featureTree',
      }

      expect(validateSimpleLayout(missingAreaType)).toBe(false)
      expect(validateSimpleLayout(missingLabel)).toBe(false)
      expect(validateSimpleLayout(validLayout)).toBe(true)
    })
  })
})
