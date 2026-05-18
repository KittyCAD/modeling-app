import {
  Registry,
  defineRegistryItem,
  provideService,
} from '@kittycad/registry'
import { signal } from '@preact/signals-core'
import {
  DefaultLayoutPaneID,
  DefaultLayoutToolbarID,
} from '@src/lib/layout/configs/default'
import {
  createLayoutService,
  createLayoutServiceRegistryItem,
} from '@src/lib/layout/service'
import { LayoutType } from '@src/lib/layout/types'
import type { Layout } from '@src/lib/layout/types'
import { findLayoutChildNode } from '@src/lib/layout/utils'
import type { SettingsType } from '@src/lib/settings/initialSettings'
import {
  SKETCH_DEBUGGER_AREA_TYPE,
  SKETCH_DEBUGGER_PANE_ID,
} from '@src/machines/sketchSolve/sketchSolverDebugger'
import {
  layoutAreaLibraryValueSpec,
  layoutContributionsValueSpec,
} from '@src/registry/contracts/layout'
import {
  type ProjectService,
  projectService,
} from '@src/registry/contracts/project'
import { settingsValueSpec } from '@src/registry/contracts/settings'
import modeSketch from '@src/registry/plugins/modeSketch'
import { describe, expect, it } from 'vitest'

function createSettings(showSketchDebuggerPane: boolean): SettingsType {
  return {
    debug: {
      showSketchDebuggerPane: {
        current: showSketchDebuggerPane,
      },
    },
  } as unknown as SettingsType
}

function createProjectServiceItem(settings: ProjectService['settings']) {
  return defineRegistryItem({
    providesServices: [
      provideService(projectService, {
        project: {} as ProjectService['project'],
        settings,
        sketchSolveScenePlugins: signal([]),
      }),
    ],
  })
}

function rightToolbar(
  layout: Layout
): Extract<Layout, { type: LayoutType.Panes }> {
  const node = findLayoutChildNode({
    rootLayout: layout,
    targetNodeId: DefaultLayoutToolbarID.Right,
  })
  expect(node?.type).toBe(LayoutType.Panes)
  return node as Extract<Layout, { type: LayoutType.Panes }>
}

describe('sketch debugger pane extension', () => {
  it('contributes a debug-controlled setting and right-sidebar pane', () => {
    const registry = new Registry()
    const settings = signal(createSettings(false))

    registry.configure([createProjectServiceItem(settings), modeSketch])

    const setting = registry
      .get(settingsValueSpec)
      .debug.showSketchDebuggerPane.createSetting()
    const areaLibrary = registry.signal(layoutAreaLibraryValueSpec)
    const contribution = registry
      .get(layoutContributionsValueSpec)
      .find((item) => item.id === 'mode-sketch.sketch-debugger-pane')

    expect(setting.default).toBe(false)
    expect(areaLibrary.value['modeSketch.sketchDebugger']?.hide()).toBe(true)
    expect(contribution).toMatchObject({
      kind: 'area',
      pane: {
        id: 'sketch-debugger',
        label: 'Sketch Debugger',
        areaType: 'modeSketch.sketchDebugger',
      },
      placement: {
        targetPaneId: 'right-toolbar',
        afterId: 'ttc',
      },
      initiallyOpen: false,
    })

    settings.value = createSettings(true)

    const area = areaLibrary.value['modeSketch.sketchDebugger']
    expect(area).toBeDefined()
    expect(area?.hide()).toBe(false)
  })

  it('inserts and opens the debugger pane into an existing layout when the debug setting is enabled', async () => {
    const registry = new Registry()
    const settings = signal(createSettings(false))
    const layout = signal<Layout>({
      id: 'root',
      label: 'Root',
      type: LayoutType.Splits,
      orientation: 'inline',
      sizes: [70, 30],
      children: [
        {
          id: 'modeling-scene',
          label: 'Modeling scene',
          type: LayoutType.Simple,
          areaType: 'modeling',
        },
        {
          id: DefaultLayoutToolbarID.Right,
          label: DefaultLayoutToolbarID.Right,
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
              areaType: 'ttc',
              icon: 'sparkles',
            },
          ],
        },
      ],
    })

    registry.configure([
      createProjectServiceItem(settings),
      createLayoutServiceRegistryItem(createLayoutService(layout)),
      modeSketch,
    ])
    registry.get(layoutContributionsValueSpec)
    await Promise.resolve()

    expect(
      findLayoutChildNode({
        rootLayout: layout.value,
        targetNodeId: SKETCH_DEBUGGER_PANE_ID,
      })
    ).toBeUndefined()

    settings.value = createSettings(true)
    await Promise.resolve()

    expect(
      findLayoutChildNode({
        rootLayout: layout.value,
        targetNodeId: SKETCH_DEBUGGER_PANE_ID,
      })
    ).toMatchObject({
      id: SKETCH_DEBUGGER_PANE_ID,
      areaType: SKETCH_DEBUGGER_AREA_TYPE,
    })
    expect(rightToolbar(layout.value).activeIndices).toEqual([0, 1])
  })

  it('opens an existing inactive debugger pane when the debug setting is enabled', async () => {
    const registry = new Registry()
    const settings = signal(createSettings(false))
    const layout = signal<Layout>({
      id: 'root',
      label: 'Root',
      type: LayoutType.Splits,
      orientation: 'inline',
      sizes: [70, 30],
      children: [
        {
          id: 'modeling-scene',
          label: 'Modeling scene',
          type: LayoutType.Simple,
          areaType: 'modeling',
        },
        {
          id: DefaultLayoutToolbarID.Right,
          label: DefaultLayoutToolbarID.Right,
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
              areaType: 'ttc',
              icon: 'sparkles',
            },
            {
              id: SKETCH_DEBUGGER_PANE_ID,
              label: 'Sketch Debugger',
              type: LayoutType.Simple,
              areaType: SKETCH_DEBUGGER_AREA_TYPE,
              icon: 'bug',
            },
          ],
        },
      ],
    })

    registry.configure([
      createProjectServiceItem(settings),
      createLayoutServiceRegistryItem(createLayoutService(layout)),
      modeSketch,
    ])
    registry.get(layoutContributionsValueSpec)
    await Promise.resolve()

    expect(rightToolbar(layout.value).activeIndices).toEqual([0])

    settings.value = createSettings(true)
    await Promise.resolve()

    expect(rightToolbar(layout.value).activeIndices).toEqual([0, 1])
  })
})
