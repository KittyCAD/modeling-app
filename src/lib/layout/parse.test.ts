import type {
  Layout,
  Action,
  SplitLayout,
  PaneLayout,
  SimpleLayout,
} from '@src/lib/layout/types'
import { LayoutType } from '@src/lib/layout/types'
import { parseLayoutInner, parseAction } from '@src/lib/layout/parse'
import { defaultLayoutConfig } from '@src/lib/layout/configs/default'
import { testLayoutConfig } from '@src/lib/layout/configs/test'

const validSimpleLayout = {
  type: LayoutType.Simple,
  id: crypto.randomUUID(),
  label: 'Test simple',
  areaType: 'featureTree',
} satisfies SimpleLayout

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
} satisfies SplitLayout

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
} satisfies PaneLayout

describe('Layout utils', () => {
  describe('Layout parsing', () => {
    describe('simple layouts', () => {
      it('should parse valid simple layout with no change', () => {
        // Nothing should be altered if the layout is valid
        expect(parseLayoutInner(validSimpleLayout)).toStrictEqual(
          validSimpleLayout
        )
      })

      it('should error on missing or bad areaType', () => {
        const { areaType: _, ...missingAreaType } = validSimpleLayout

        const badAreaType = {
          ...validSimpleLayout,
          areaType: 'code',
        } as unknown as Layout

        expect(parseLayoutInner(badAreaType)).toBeInstanceOf(Error)
        expect(parseLayoutInner(missingAreaType)).toBeInstanceOf(Error)
      })

      it('should heal a missing label', () => {
        const { label: _, ...missingLabel } = structuredClone(validSimpleLayout)

        expect(parseLayoutInner(missingLabel)).toHaveProperty('label')
      })
    })

    describe('split layouts', () => {
      it('should parse valid split layout', () => {
        // Nothing should be altered if the layout is valid
        expect(parseLayoutInner(validSplitLayout)).toStrictEqual(
          validSplitLayout
        )
      })

      it('should heal missing or invalid sizes', () => {
        const hasTooManySizes = structuredClone(validSplitLayout)
        hasTooManySizes.sizes = [50, 25, 25]
        const hasHigherThanOneHundredSizes = structuredClone(validSplitLayout)
        hasHigherThanOneHundredSizes.sizes = [50, 75]

        const { sizes: _, ...missingSizes } = structuredClone(validSplitLayout)

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

        const { orientation: _, ...missingOrientation } =
          structuredClone(validSplitLayout)

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
        expect(parseAction(validAction)).toStrictEqual(validAction)
      })

      it('should heal a missing label', () => {
        const { label: _, ...missingLabel } = structuredClone(validAction)

        expect(parseAction(missingLabel)).toHaveProperty('label')
      })

      it('should heal a missing id', () => {
        const { id: _, ...missingID } = structuredClone(validAction)

        expect(parseAction(missingID)).not.toBeInstanceOf(Error)
        expect(parseAction(missingID)).toHaveProperty('id')
      })

      it('should fail on missing or bad icon', () => {
        const { icon: _, ...missingIcon } = structuredClone(validAction)
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
        expect(parseLayoutInner(validPaneLayout)).toStrictEqual(validPaneLayout)
      })

      it('should heal missing or invalid sizes', () => {
        const hasTooFewSizes = structuredClone(validPaneLayout)
        hasTooFewSizes.sizes = [100]
        const hasHigherThanOneHundredSizes = structuredClone(validPaneLayout)
        hasHigherThanOneHundredSizes.sizes = [50, 75]

        const { sizes: _, ...missingSizes } = structuredClone(validPaneLayout)

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

        const { splitOrientation: _, ...missingOrientation } =
          structuredClone(validPaneLayout)

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
        // @ts-expect-error: We're breaking a valid Layout
        hasInvalidChild.children[1].type = 'bad-type'
        // @ts-expect-error: We're breaking a valid Layout
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
        hasInvalidAction.actions = [
          structuredClone(validAction),
          structuredClone(validAction),
        ]
        // @ts-expect-error: We're breaking a valid Layout
        hasInvalidAction.actions[1].icon = 'bad-icon'

        const parsedLayout = parseLayoutInner(hasInvalidAction)

        expect(parsedLayout).not.toBeInstanceOf(Error)
        if (parsedLayout instanceof Error || parsedLayout.type !== 'panes') {
          throw new Error('this is for TS type narrowing within the test')
        }
        expect(parsedLayout.actions).toHaveLength(1)
      })

      it('should clear sizes if there are no activeIndices', () => {
        const hasNoActiveIndices = structuredClone(validPaneLayout)
        hasNoActiveIndices.activeIndices = []

        expect(parseLayoutInner(hasNoActiveIndices)).toHaveProperty('sizes', [])
      })
    })

    it('parses onExpandSize for those pane layouts that have it', () => {
      const paneChildWithOnExpandSize: PaneLayout =
        structuredClone(validPaneLayout)
      paneChildWithOnExpandSize.onExpandSize = 30

      expect(parseLayoutInner(paneChildWithOnExpandSize)).toHaveProperty(
        'onExpandSize',
        30
      )
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
