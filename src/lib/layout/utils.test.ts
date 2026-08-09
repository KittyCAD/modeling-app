import {
  DefaultLayoutPaneID,
  DefaultLayoutToolbarID,
} from '@src/lib/layout/configs/default'
import type {
  Layout,
  LayoutMigrationMap,
  LayoutWithMetadata,
} from '@src/lib/layout/types'
import { AreaType, LayoutType } from '@src/lib/layout/types'
import {
  applyLayoutContribution,
  applyLayoutMigrationMap,
  closeAllPanes,
  parseLayoutWithMigrations,
  setOpenPanes,
} from '@src/lib/layout/utils'
import { describe, expect, it } from 'vitest'

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

function parseMigratedLayout(layoutWithMetadata: LayoutWithMetadata) {
  const migrated = parseLayoutWithMigrations(layoutWithMetadata)

  expect(migrated).not.toBeInstanceOf(Error)
  return migrated as LayoutWithMetadata
}

function flattenLayout(layout: Layout): Layout[] {
  return [
    layout,
    ...('children' in layout ? layout.children.flatMap(flattenLayout) : []),
  ]
}

function expectNoRetiredModelTreeNodes(layout: Layout) {
  const nodes = flattenLayout(layout)
  expect(nodes.map((node) => node.id)).not.toContain(
    DefaultLayoutPaneID.FeatureTree
  )
  expect(nodes.map((node) => node.id)).not.toContain('operations-list')
  expect(nodes.map((node) => node.id)).not.toContain('bodies-list')
  expect(
    nodes
      .filter((node) => node.type === LayoutType.Simple)
      .map((node) => node.areaType)
  ).not.toEqual(expect.arrayContaining([AreaType.FeatureTree, AreaType.Bodies]))
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

      setOpenPanes(layout, [DefaultLayoutPaneID.Code])

      expect(layout).toHaveProperty('children[0].activeIndices', [1])
      expect(layout).toHaveProperty('children[1].activeIndices', [])
    })

    it('ignores the retired feature tree pane when setting open panes', () => {
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
            activeIndices: [1],
            sizes: [100],
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
            ],
            actions: [],
          },
          {
            id: DefaultLayoutToolbarID.Right,
            label: 'Right',
            type: LayoutType.Panes,
            side: 'inline-end',
            activeIndices: [],
            sizes: [],
            splitOrientation: 'block',
            children: [],
            actions: [],
          },
        ],
      }

      setOpenPanes(layout, [DefaultLayoutPaneID.FeatureTree])

      expect(layout).toHaveProperty('children[0].activeIndices', [])
      expect(layout).toHaveProperty('children[1].activeIndices', [])
    })
  })

  describe('layout contributions', () => {
    it('inserts missing contributed areas into a target pane layout', () => {
      const layout: Layout = {
        id: 'root',
        label: 'Root',
        type: LayoutType.Panes,
        side: 'inline-start',
        activeIndices: [0],
        sizes: [100],
        splitOrientation: 'block',
        children: [
          {
            id: 'existing-pane',
            label: 'Existing',
            type: LayoutType.Simple,
            areaType: AreaType.Code,
            icon: 'code',
          },
        ],
      }

      const result = applyLayoutContribution({
        rootLayout: layout,
        contribution: {
          id: 'plugin-area-default',
          kind: 'area',
          pane: {
            id: 'plugin-pane',
            label: 'Plugin',
            type: LayoutType.Simple,
            areaType: 'plugin.area',
            icon: 'stopwatch',
          },
          placement: {
            targetPaneId: 'root',
            afterId: 'existing-pane',
          },
          initiallyOpen: true,
        },
      })

      expect(result).toStrictEqual({ applied: true, reason: 'applied' })
      expect(layout).toHaveProperty('children[1].id', 'plugin-pane')
      expect(layout).toHaveProperty('activeIndices', [0, 1])
      expect(layout).toHaveProperty('sizes', [50, 50])
    })

    it('does not duplicate contributed areas already present anywhere in the layout', () => {
      const layout = structuredClone(basicSplitLayout)

      const result = applyLayoutContribution({
        rootLayout: layout,
        contribution: {
          id: 'plugin-area-default',
          kind: 'area',
          pane: {
            id: 'ttc',
            label: 'Plugin',
            type: LayoutType.Simple,
            areaType: 'plugin.area',
            icon: 'stopwatch',
          },
          placement: {
            targetPaneId: 'root',
          },
        },
      })

      expect(result).toStrictEqual({
        applied: false,
        reason: 'already-present',
      })
    })

    it('inserts missing contributed actions into a target pane layout', () => {
      const layout: Layout = {
        id: 'root',
        label: 'Root',
        type: LayoutType.Panes,
        side: 'inline-start',
        activeIndices: [],
        sizes: [],
        splitOrientation: 'block',
        children: [],
        actions: [
          {
            id: 'existing-action',
            label: 'Existing',
            icon: 'command',
            actionType: 'existing.action',
          },
        ],
      }

      const result = applyLayoutContribution({
        rootLayout: layout,
        contribution: {
          id: 'plugin-action-default',
          kind: 'action',
          action: {
            id: 'plugin-action',
            label: 'Plugin action',
            icon: 'stopwatch',
            actionType: 'plugin.action',
          },
          placement: {
            targetPaneId: 'root',
            beforeId: 'existing-action',
          },
        },
      })

      expect(result).toStrictEqual({ applied: true, reason: 'applied' })
      expect(layout).toHaveProperty('actions[0].id', 'plugin-action')
      expect(layout).toHaveProperty('actions[1].id', 'existing-action')
    })
  })

  describe('persisted layout migrations', () => {
    it('falls back to the current default layout for a lone v2 feature tree root', () => {
      const migrated = parseMigratedLayout({
        version: 'v2',
        layout: {
          id: DefaultLayoutPaneID.FeatureTree,
          label: 'Feature Tree',
          type: LayoutType.Simple,
          areaType: AreaType.FeatureTree,
        },
      })

      expect(migrated).toHaveProperty('version', 'v4')
      expect(migrated).toHaveProperty('layout.id', 'default')
      expectNoRetiredModelTreeNodes(migrated.layout)
    })

    it('removes an active v3 feature tree pane and keeps other active panes', () => {
      const migrated = parseMigratedLayout({
        version: 'v3',
        layout: {
          id: 'root',
          label: 'Root',
          type: LayoutType.Splits,
          orientation: 'inline',
          sizes: [30, 70],
          children: [
            {
              id: DefaultLayoutToolbarID.Left,
              label: 'Left',
              type: LayoutType.Panes,
              side: 'inline-start',
              activeIndices: [0, 1],
              sizes: [40, 60],
              splitOrientation: 'block',
              children: [
                {
                  id: DefaultLayoutPaneID.FeatureTree,
                  label: 'Feature Tree',
                  type: LayoutType.Splits,
                  orientation: 'block',
                  sizes: [70, 30],
                  icon: 'model',
                  children: [
                    {
                      id: 'operations-list',
                      label: 'Feature Tree',
                      type: LayoutType.Simple,
                      areaType: AreaType.FeatureTree,
                    },
                    {
                      id: 'bodies-list',
                      label: 'Bodies',
                      type: LayoutType.Simple,
                      areaType: AreaType.Bodies,
                    },
                  ],
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
            },
            {
              id: 'modeling-scene',
              label: 'Modeling scene',
              type: LayoutType.Simple,
              areaType: AreaType.ModelingScene,
            },
          ],
        },
      })

      expect(migrated).toHaveProperty('version', 'v4')
      expectNoRetiredModelTreeNodes(migrated.layout)
      expect(migrated).toHaveProperty(
        'layout.children[0].children[0].id',
        'code'
      )
      expect(migrated).toHaveProperty('layout.children[0].activeIndices', [0])
      expect(migrated).toHaveProperty('layout.children[0].sizes', [100])
    })

    it('removes an inactive v3 feature tree pane without changing the active pane', () => {
      const migrated = parseMigratedLayout({
        version: 'v3',
        layout: {
          id: DefaultLayoutToolbarID.Left,
          label: 'Left',
          type: LayoutType.Panes,
          side: 'inline-start',
          activeIndices: [1],
          sizes: [100],
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
          ],
        },
      })

      expect(migrated).toHaveProperty('version', 'v4')
      expectNoRetiredModelTreeNodes(migrated.layout)
      expect(migrated).toHaveProperty('layout.children[0].id', 'code')
      expect(migrated).toHaveProperty('layout.activeIndices', [0])
      expect(migrated).toHaveProperty('layout.sizes', [100])
    })

    it('removes nested v3 bodies splits and normalizes split sizes', () => {
      const migrated = parseMigratedLayout({
        version: 'v3',
        layout: {
          id: 'nested-root',
          label: 'Nested root',
          type: LayoutType.Splits,
          orientation: 'block',
          sizes: [20, 30, 50],
          children: [
            {
              id: 'code',
              label: 'Code',
              type: LayoutType.Simple,
              areaType: AreaType.Code,
            },
            {
              id: 'nested-bodies',
              label: 'Nested bodies split',
              type: LayoutType.Splits,
              orientation: 'inline',
              sizes: [100],
              children: [
                {
                  id: 'bodies-list',
                  label: 'Bodies',
                  type: LayoutType.Simple,
                  areaType: AreaType.Bodies,
                },
              ],
            },
            {
              id: 'files',
              label: 'Files',
              type: LayoutType.Simple,
              areaType: AreaType.Files,
            },
          ],
        },
      })

      expect(migrated).toHaveProperty('version', 'v4')
      expectNoRetiredModelTreeNodes(migrated.layout)
      expect(migrated).toHaveProperty('layout.children.length', 2)
      expect(migrated).toHaveProperty('layout.sizes.length', 2)
      expect(
        (
          (migrated.layout as Extract<Layout, { type: LayoutType.Splits }>)
            .sizes ?? []
        ).reduce((sum, size) => sum + size, 0)
      ).toBe(100)
    })

    it('falls back to the current default layout for a lone v3 feature tree root', () => {
      const migrated = parseMigratedLayout({
        version: 'v3',
        layout: {
          id: DefaultLayoutPaneID.FeatureTree,
          label: 'Feature Tree',
          type: LayoutType.Splits,
          orientation: 'block',
          sizes: [70, 30],
          children: [
            {
              id: 'operations-list',
              label: 'Feature Tree',
              type: LayoutType.Simple,
              areaType: AreaType.FeatureTree,
            },
            {
              id: 'bodies-list',
              label: 'Bodies',
              type: LayoutType.Simple,
              areaType: AreaType.Bodies,
            },
          ],
        },
      })

      expect(migrated).toHaveProperty('version', 'v4')
      expect(migrated).toHaveProperty('layout.id', 'default')
      expectNoRetiredModelTreeNodes(migrated.layout)
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
