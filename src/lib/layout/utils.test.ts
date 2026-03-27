import { AreaType, LayoutType } from '@src/lib/layout/types'
import type {
  Layout,
  LayoutMigrationMap,
  LayoutWithMetadata,
} from '@src/lib/layout/types'
import {
  applyLayoutMigrationMap,
  closeAllPanes,
  setOpenPanes,
} from '@src/lib/layout/utils'
import {
  DefaultLayoutPaneID,
  DefaultLayoutToolbarID,
} from '@src/lib/layout/configs/default'
import { expect } from 'vitest'
import { it } from 'vitest'
import { describe } from 'vitest'

const basicSplitLayout: Layout = {
  id: 'root',
  label: 'Root',
  type: LayoutType.Splits,
  orientation: 'inline',
  sizes: [50, 50],
  children: [
    {
      id: 'ttc',
      type: LayoutType.Simple,
      areaType: AreaType.TTC,
      label: 'TTC',
    },
    {
      id: 'another',
      type: LayoutType.Simple,
      areaType: AreaType.Code,
      label: 'Code',
    },
  ],
}

describe('Layout utils', () => {
  describe('pane visibility utilities', () => {
    it('closes every open pane in a pane layout', () => {
      const layout: Layout = {
        id: 'root',
        label: 'Root',
        type: LayoutType.Splits,
        orientation: 'inline',
        sizes: [50, 50],
        children: [
          {
            id: DefaultLayoutToolbarID.Left,
            label: 'Left',
            type: LayoutType.Panes,
            side: 'inline-start',
            activeIndices: [0, 1, 2],
            sizes: [34, 33, 33],
            splitOrientation: 'block',
            children: [
              {
                id: DefaultLayoutPaneID.FeatureTree,
                label: 'Feature Tree',
                type: LayoutType.Simple,
                areaType: AreaType.FeatureTree,
                icon: 'model',
              },
              {
                id: DefaultLayoutPaneID.Code,
                label: 'Code',
                type: LayoutType.Simple,
                areaType: AreaType.Code,
                icon: 'code',
              },
              {
                id: DefaultLayoutPaneID.Files,
                label: 'Files',
                type: LayoutType.Simple,
                areaType: AreaType.Files,
                icon: 'folder',
              },
            ],
            actions: [],
          },
          {
            id: DefaultLayoutToolbarID.Right,
            label: 'Right',
            type: LayoutType.Panes,
            side: 'inline-end',
            activeIndices: [0],
            sizes: [100],
            splitOrientation: 'block',
            children: [
              {
                id: DefaultLayoutPaneID.TTC,
                label: 'Zookeeper',
                type: LayoutType.Simple,
                areaType: AreaType.TTC,
                icon: 'sparkles',
              },
            ],
            actions: [],
          },
        ],
      }

      closeAllPanes(layout, DefaultLayoutToolbarID.Left)

      expect(layout).toHaveProperty('children[0].activeIndices', [])
      expect(layout).toHaveProperty('children[0].sizes', [])
    })

    it('opens only the requested panes', () => {
      const layout: Layout = {
        id: 'root',
        label: 'Root',
        type: LayoutType.Splits,
        orientation: 'inline',
        sizes: [50, 50],
        children: [
          {
            id: DefaultLayoutToolbarID.Left,
            label: 'Left',
            type: LayoutType.Panes,
            side: 'inline-start',
            activeIndices: [0, 1, 2],
            sizes: [34, 33, 33],
            splitOrientation: 'block',
            children: [
              {
                id: DefaultLayoutPaneID.FeatureTree,
                label: 'Feature Tree',
                type: LayoutType.Simple,
                areaType: AreaType.FeatureTree,
                icon: 'model',
              },
              {
                id: DefaultLayoutPaneID.Code,
                label: 'Code',
                type: LayoutType.Simple,
                areaType: AreaType.Code,
                icon: 'code',
              },
              {
                id: DefaultLayoutPaneID.Files,
                label: 'Files',
                type: LayoutType.Simple,
                areaType: AreaType.Files,
                icon: 'folder',
              },
              {
                id: DefaultLayoutPaneID.Variables,
                label: 'Variables',
                type: LayoutType.Simple,
                areaType: AreaType.Variables,
                icon: 'make-variable',
              },
            ],
            actions: [],
          },
          {
            id: DefaultLayoutToolbarID.Right,
            label: 'Right',
            type: LayoutType.Panes,
            side: 'inline-end',
            activeIndices: [0],
            sizes: [100],
            splitOrientation: 'block',
            children: [
              {
                id: DefaultLayoutPaneID.TTC,
                label: 'Zookeeper',
                type: LayoutType.Simple,
                areaType: AreaType.TTC,
                icon: 'sparkles',
              },
            ],
            actions: [],
          },
        ],
      }

      setOpenPanes(layout, [DefaultLayoutPaneID.FeatureTree])

      expect(layout).toHaveProperty('children[0].activeIndices', [0])
      expect(layout).toHaveProperty('children[1].activeIndices', [])
    })
  })

  describe('layout migrations', () => {
    it('should do nothing if we just return the layout back', () => {
      const migrationMap: LayoutMigrationMap = new Map([
        [
          'v1',
          {
            newVersion: 'v2',
            transformationSets: [
              { matcher: true, transformations: [(l) => l] },
              { matcher: true, transformations: [(l) => l] },
              { matcher: true, transformations: [(l) => l] },
            ],
          },
        ],
      ])

      const currentLayout: LayoutWithMetadata = {
        version: 'v1',
        layout: structuredClone(basicSplitLayout),
      }
      const result = applyLayoutMigrationMap(currentLayout, migrationMap)
      const { version: _a, ...resultWithoutId } = result
      const { version: _b, ...inputWithoutId } = currentLayout
      expect(result).toHaveProperty('version', 'v2')
      expect(resultWithoutId).toStrictEqual(inputWithoutId)
    })

    it('should be able to change all layout IDs', () => {
      const migrationMap: LayoutMigrationMap = new Map()
      migrationMap.set('v1', {
        newVersion: 'v2',
        transformationSets: [
          {
            matcher: true,
            transformations: [(l) => ({ ...l, id: `some-new-prefix:${l.id}` })],
          },
        ],
      })

      const currentLayout: LayoutWithMetadata = {
        version: 'v1',
        layout: {
          id: 'root',
          type: LayoutType.Simple,
          label: 'Test',
          areaType: AreaType.FeatureTree,
        },
      }

      const result = applyLayoutMigrationMap(currentLayout, migrationMap)
      expect(result).toStrictEqual({
        version: 'v2',
        layout: {
          ...currentLayout.layout,
          id: 'some-new-prefix:root',
        },
      })
    })
    it('should apply multiple transformations', () => {
      const migrationMap: LayoutMigrationMap = new Map()
      migrationMap.set('v1', {
        newVersion: 'v2',
        transformationSets: [
          {
            matcher: (l) => l.id === 'ttc',
            transformations: [() => null],
          },
          {
            matcher: (l) => l.type === LayoutType.Splits,
            transformations: [(l) => ({ ...l, label: 'Split!' })],
          },
        ],
      })

      const currentLayout: LayoutWithMetadata = {
        version: 'v1',
        layout: {
          id: 'root',
          label: 'Root',
          type: LayoutType.Splits,
          orientation: 'inline',
          sizes: [50, 50],
          children: [
            {
              id: 'ttc',
              type: LayoutType.Simple,
              areaType: AreaType.TTC,
              label: 'TTC',
            },
            {
              id: 'another',
              type: LayoutType.Simple,
              areaType: AreaType.Code,
              label: 'Code',
            },
          ],
        },
      }

      const result = applyLayoutMigrationMap(currentLayout, migrationMap)
      expect(result).toHaveProperty('version', 'v2')
      expect(result).toHaveProperty('layout.label', 'Split!')
      expect(result).toHaveProperty('layout.children', [
        {
          id: 'another',
          type: LayoutType.Simple,
          areaType: AreaType.Code,
          label: 'Code',
        },
      ])
    })
    it('should apply multiple migrations in a row', () => {
      const migrationMap: LayoutMigrationMap = new Map()
      migrationMap.set('v1', {
        newVersion: 'v2',
        transformationSets: [
          {
            matcher: (l) => l.type === LayoutType.Splits,
            transformations: [(l) => ({ ...l, label: 'Split!' })],
          },
        ],
      })
      migrationMap.set('v2', {
        newVersion: 'v3',
        transformationSets: [
          {
            matcher: (l) => l.id === 'ttc',
            transformations: [() => null],
          },
        ],
      })

      const currentLayout: LayoutWithMetadata = {
        version: 'v1',
        layout: structuredClone(basicSplitLayout),
      }

      const result = applyLayoutMigrationMap(currentLayout, migrationMap)
      expect(result).toHaveProperty('version', 'v3')
      expect(result).toHaveProperty('layout.label', 'Split!')
      expect(result).toHaveProperty('layout.children', [
        {
          id: 'another',
          type: LayoutType.Simple,
          areaType: AreaType.Code,
          label: 'Code',
        },
      ])
    })
    it('should be able to swap an area type of nested nodes', () => {
      const migrationMap: LayoutMigrationMap = new Map()
      migrationMap.set('v1', {
        newVersion: 'v2',
        transformationSets: [
          {
            matcher: (l) =>
              l.type === LayoutType.Simple && l.areaType === AreaType.TTC,
            transformations: [
              (l) => ({ ...l, areaType: AreaType.FeatureTree }),
            ],
          },
        ],
      })
      const currentLayout: LayoutWithMetadata = {
        version: 'v1',
        layout: {
          ...basicSplitLayout,
          children: [
            {
              ...basicSplitLayout,
              id: 'nested',
              children: [
                { ...basicSplitLayout, id: 'deeper' },
                basicSplitLayout.children[0],
              ],
            },
            basicSplitLayout.children[0],
          ],
        },
      }

      const result = applyLayoutMigrationMap(currentLayout, migrationMap)
      expect(result).toHaveProperty('version', 'v2')
      expect(result).toHaveProperty(
        'layout.children[0].children[0].children[0].areaType',
        AreaType.FeatureTree
      )
      expect(result).toHaveProperty(
        'layout.children[0].children[0].children[1].areaType',
        AreaType.Code
      )
      expect(result).toHaveProperty(
        'layout.children[1].areaType',
        AreaType.FeatureTree
      )
      expect(result).toHaveProperty(
        'layout.children[0].children[1].areaType',
        AreaType.FeatureTree
      )
    })
    it('can wrap a node with a Split layout', () => {
      const migrationMap: LayoutMigrationMap = new Map()
      // In order to replace a node with a wrapped version of itself,
      // you must have a flag outside of the transformation closure
      // to toggle when that insertion occurs to prevent endless recursion,
      // because it will continue to match on itself as a child forever.
      let transformedOnce = false
      migrationMap.set('v1', {
        newVersion: 'v2',
        transformationSets: [
          {
            // Match on TTC, but only once so we don't loop
            matcher: (l) =>
              l.type === LayoutType.Simple &&
              l.areaType === AreaType.TTC &&
              !transformedOnce,
            transformations: [
              (l) => {
                // Escaping "maximum call stack exceeded"
                transformedOnce = true
                return {
                  id: 'feature-with-bodies',
                  label: 'Feature tree and bodies',
                  type: LayoutType.Splits,
                  sizes: [70, 30],
                  orientation: 'block',
                  children: [
                    // We're returning the matched node as a child of a new wrapper.
                    l,
                    {
                      id: 'bodies',
                      label: 'Bodies',
                      type: LayoutType.Simple,
                      areaType: AreaType.Debug,
                    },
                  ],
                }
              },
            ],
          },
        ],
      })

      const currentLayout: LayoutWithMetadata = {
        version: 'v1',
        layout: structuredClone(basicSplitLayout),
      }
      const result = applyLayoutMigrationMap(currentLayout, migrationMap)
      expect(result).toHaveProperty('version', 'v2')
      expect(result).toHaveProperty(
        'layout.children[0].type',
        LayoutType.Splits
      )
      expect(result).toHaveProperty(
        'layout.children[0].children[0].areaType',
        AreaType.TTC
      )
      expect(result).toHaveProperty(
        'layout.children[0].children[1].areaType',
        AreaType.Debug
      )
    })

    it(`should be able to match on a split by its children and adjust its sizes`, () => {
      const migrationMap: LayoutMigrationMap = new Map()
      migrationMap.set('v1', {
        newVersion: 'v2',
        transformationSets: [
          {
            // Matching on Split layouts that contain TTC areas
            matcher: (l) =>
              l.type === LayoutType.Splits &&
              l.children.find(
                (c) =>
                  c.type === LayoutType.Simple && c.areaType === AreaType.TTC
              ) !== undefined,
            transformations: [
              // First transformation: add a Debug split and add a dummy item to the sizes
              (l) => {
                if (l.type !== LayoutType.Splits) {
                  return l
                }
                return {
                  ...l,
                  sizes: [...l.sizes, 0],
                  children: [
                    {
                      id: 'new-debug',
                      label: 'Inserted debug',
                      type: LayoutType.Simple,
                      areaType: AreaType.Debug,
                    },
                    ...l.children,
                  ],
                }
              },
              // Second transform: set the size of TTC, then split remainder among the others
              (l) => {
                if (l.type !== LayoutType.Splits) {
                  return l
                }
                const ttcSplitIndex = l.children.findIndex(
                  (c) =>
                    c.type === LayoutType.Simple && c.areaType === AreaType.TTC
                )
                const ttcSize = 70
                const remainderSize = (100 - ttcSize) / (l.sizes.length - 1)
                const newSizes: number[] = new Array(l.sizes.length).fill(
                  remainderSize
                )
                newSizes[ttcSplitIndex] = ttcSize
                return { ...l, sizes: newSizes }
              },
            ],
          },
        ],
      })

      const currentLayout: LayoutWithMetadata = {
        version: 'v1',
        layout: structuredClone(basicSplitLayout),
      }

      const result = applyLayoutMigrationMap(currentLayout, migrationMap)
      expect(result).toHaveProperty('version', 'v2')
      expect(result).toHaveProperty('layout.type', LayoutType.Splits)
      expect(result).toHaveProperty('layout.sizes', [15, 70, 15])
      expect(result).toHaveProperty(
        'layout.children[0].areaType',
        AreaType.Debug
      )
      expect(result).toHaveProperty('layout.children[1].areaType', AreaType.TTC)
    })
  })
})
