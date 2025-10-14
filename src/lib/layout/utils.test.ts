import { LayoutType, type Layout, type Action } from '@src/lib/layout/types'
import { parseLayoutInner, parseAction } from '@src/lib/layout/utils'
import { defaultLayoutConfig } from '@src/lib/layout/defaultLayoutConfig'
import { testLayoutConfig } from '@src/lib/layout/testLayoutConfig'

const validSimpleLayout = {
  type: LayoutType.Simple,
  id: crypto.randomUUID(),
  label: 'Test simple',
  areaType: 'featureTree',
} satisfies Layout

const validSplitLayout = {
  type: LayoutType.Splits,
  id: 'test',
  label: 'Test split',
  orientation: 'inline',
  sizes: [50, 50],
  children: [
    structuredClone(validSimpleLayout),
    structuredClone(validSimpleLayout),
  ],
} satisfies Layout

const validAction = {
  id: crypto.randomUUID(),
  label: 'Test action',
  icon: 'refresh',
  actionType: 'refreshApp',
} satisfies Action

const validPaneLayout = {
  type: LayoutType.Panes,
  id: 'test',
  label: 'Test split',
  side: 'inline-start',
  splitOrientation: 'inline',
  sizes: [40, 60],
  activeIndices: [1, 3],
  children: [
    { ...validSimpleLayout, icon: 'model' },
    { ...validSimpleLayout, icon: 'sparkles' },
    { ...validSimpleLayout, icon: 'code' },
    { ...validSimpleLayout, icon: 'logs' },
  ],
  actions: [structuredClone(validAction)],
} satisfies Layout

describe('Layout utils', () => {
  describe('Layout parsing', () => {
    describe('simple layouts', () => {
      it('should parse valid simple layout with no change', () => {
        // Nothing should be altered if the layout is valid
        expect(parseLayoutInner(validSimpleLayout)).toBe(validSimpleLayout)
      })

      it('should error on missing or bad areaType', () => {
        // Now validate some unhappy paths
        const missingAreaType = structuredClone(validSimpleLayout)
        // @ts-ignore
        delete missingAreaType.areaType

        const badAreaType = {
          ...validSimpleLayout,
          areaType: 'code',
        } as unknown as Layout

        expect(parseLayoutInner(badAreaType)).toBeInstanceOf(Error)
        expect(parseLayoutInner(missingAreaType)).toBeInstanceOf(Error)
      })

      it('should heal a missing label', () => {
        const missingLabel = structuredClone(validSimpleLayout)
        // @ts-ignore
        delete missingLabel.label

        expect(parseLayoutInner(missingLabel)).toHaveProperty('label')
      })
    })

    describe('split layouts', () => {
      it('should parse valid split layout', () => {
        // Nothing should be altered if the layout is valid
        expect(parseLayoutInner(validSplitLayout)).toBe(validSplitLayout)
      })

      it('should heal missing or invalid sizes', () => {
        const hasTooManySizes = structuredClone(validSplitLayout)
        hasTooManySizes.sizes = [50, 25, 25]
        const hasHigherThanOneHundredSizes = structuredClone(validSplitLayout)
        hasHigherThanOneHundredSizes.sizes = [50, 75]

        const missingSizes = structuredClone(validSplitLayout)
        // @ts-ignore
        delete missingSizes.sizes

        expect(parseLayoutInner(hasTooManySizes)).toHaveProperty(
          'sizes',
          [50, 50]
        )
        expect(parseLayoutInner(hasHigherThanOneHundredSizes)).toHaveProperty(
          'sizes',
          [50, 50]
        )
        expect(parseLayoutInner(missingSizes)).toHaveProperty('sizes', [50, 50])
      })

      it('should heal missing or invalid orientation', () => {
        const hasBadOrientation = structuredClone(validSplitLayout)
        hasBadOrientation.orientation = 'bad-bad' as 'inline'

        const missingOrientation = structuredClone(validSplitLayout)
        // @ts-ignore
        delete missingOrientation.orientation

        expect(parseLayoutInner(hasBadOrientation)).not.toBeInstanceOf(Error)
        expect(parseLayoutInner(hasBadOrientation)).toHaveProperty(
          'orientation'
        )
        expect(parseLayoutInner(missingOrientation)).toHaveProperty(
          'orientation'
        )
      })
    })

    describe('actions', () => {
      it('should parse valid action', () => {
        // Nothing should be altered if the layout is valid
        expect(parseAction(validAction)).toBe(validAction)
      })

      it('should heal a missing label', () => {
        const missingLabel = structuredClone(validAction)
        // @ts-ignore
        delete missingLabel.label

        expect(parseAction(missingLabel)).toHaveProperty('label')
      })

      it('should heal a missing id', () => {
        const missingID = structuredClone(validAction)
        // @ts-ignore
        delete missingID.id

        expect(parseAction(missingID)).not.toBeInstanceOf(Error)
        expect(parseAction(missingID)).toHaveProperty('id')
      })

      it('should fail on missing or bad icon', () => {
        const missingIcon = structuredClone(validAction)
        // @ts-ignore
        delete missingIcon.icon
        const badIcon = {
          ...validAction,
          icon: 'bad-bad',
        } as unknown as Action
        expect(parseAction(missingIcon)).toBeInstanceOf(Error)
        expect(parseAction(badIcon)).toBeInstanceOf(Error)
      })
    })

    describe('pane layouts', () => {
      it('should parse valid pane layout', () => {
        // Nothing should be altered if the layout is valid
        expect(parseLayoutInner(validSplitLayout)).toBe(validSplitLayout)
      })

      it('should heal missing or invalid sizes', () => {
        const hasTooFewSizes = structuredClone(validPaneLayout)
        hasTooFewSizes.sizes = [100]
        const hasHigherThanOneHundredSizes = structuredClone(validPaneLayout)
        hasHigherThanOneHundredSizes.sizes = [50, 75]

        const missingSizes = structuredClone(validPaneLayout)
        // @ts-ignore
        delete missingSizes.sizes

        expect(parseLayoutInner(hasTooFewSizes)).toHaveProperty(
          'sizes',
          [50, 50]
        )
        expect(parseLayoutInner(hasHigherThanOneHundredSizes)).toHaveProperty(
          'sizes',
          [50, 50]
        )
        expect(parseLayoutInner(missingSizes)).toHaveProperty('sizes', [50, 50])
      })

      it('should heal missing or invalid splitOrientation', () => {
        const hasBadOrientation = structuredClone(validPaneLayout)
        hasBadOrientation.splitOrientation = 'bad-bad' as 'inline'

        const missingOrientation = structuredClone(validPaneLayout)
        // @ts-ignore
        delete missingOrientation.splitOrientation

        expect(parseLayoutInner(hasBadOrientation)).not.toBeInstanceOf(Error)
        expect(parseLayoutInner(hasBadOrientation)).toHaveProperty(
          'splitOrientation'
        )
        expect(parseLayoutInner(missingOrientation)).toHaveProperty(
          'splitOrientation'
        )
      })

      it('should drop invalid children', () => {
        const hasInvalidChild = structuredClone(validPaneLayout)
        // @ts-ignore
        hasInvalidChild.children[1].type = 'bad-type'
        // @ts-ignore
        hasInvalidChild.children[0].icon = 'bad-icon'

        const parsedLayout = parseLayoutInner(hasInvalidChild)

        expect(parsedLayout).not.toBeInstanceOf(Error)
        // We fall back hard onto dividing space evenly among the safe remaining activeIndices
        expect(parsedLayout).toHaveProperty('sizes', [100])
        expect(parsedLayout).toHaveProperty('children')
        if (parsedLayout instanceof Error || parsedLayout.type !== 'panes') {
          throw new Error('this is for TS type narrowing within the test')
        }
        // We dropped the children
        expect(parsedLayout.children).toHaveLength(2)
        // The invalid children result in unsafe activeIndices, which are also dropped
        expect(parsedLayout.activeIndices).toStrictEqual([0])
      })

      it('should drop invalid actions', () => {
        const hasInvalidAction = structuredClone(validPaneLayout)
        // @ts-ignore
        hasInvalidAction.actions = [
          structuredClone(validAction),
          structuredClone(validAction),
        ]
        // @ts-ignore
        hasInvalidAction.actions[1].icon = 'bad-icon'

        const parsedLayout = parseLayoutInner(hasInvalidAction)

        expect(parsedLayout).not.toBeInstanceOf(Error)
        if (parsedLayout instanceof Error || parsedLayout.type !== 'panes') {
          throw new Error('this is for TS type narrowing within the test')
        }
        expect(parsedLayout.actions).toHaveLength(1)
      })
    })

    it('validates the defaultLayoutConfig', () => {
      const parsedDefaultLayout = parseLayoutInner(defaultLayoutConfig)

      // Verify a few nested properties to know that we didn't error out while validating it
      expect(parsedDefaultLayout).toHaveProperty('type', 'split')
      expect(parsedDefaultLayout).toHaveProperty(
        'children.0.children.0.type',
        'simple'
      )
      expect(parsedDefaultLayout).toHaveProperty('children.2.type', 'panes')
    })

    it('validates the testLayoutConfig', () => {
      const parsedDefaultLayout = parseLayoutInner(testLayoutConfig)

      // Verify a few nested properties to know that we didn't error out while validating it
      expect(parsedDefaultLayout).toHaveProperty('type', 'split')
      expect(parsedDefaultLayout).toHaveProperty(
        'children.0.children.0.type',
        'simple'
      )
      expect(parsedDefaultLayout).toHaveProperty('children.1.type', 'split')
    })
  })
})
