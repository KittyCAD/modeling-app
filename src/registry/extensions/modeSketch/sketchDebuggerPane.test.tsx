import {
  Registry,
  defineRegistryItem,
  provideService,
} from '@kittycad/registry'
import { signal } from '@preact/signals-core'
import type { SettingsType } from '@src/lib/settings/initialSettings'
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
})
