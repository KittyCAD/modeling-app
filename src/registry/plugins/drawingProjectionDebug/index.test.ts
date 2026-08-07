import { Registry, pluginsValueSpec } from '@kittycad/registry'
import { DefaultLayoutToolbarID } from '@src/lib/layout/configs/default'
import { LayoutType } from '@src/lib/layout/types'
import {
  layoutAreaLibraryValueSpec,
  layoutContributionsValueSpec,
} from '@src/registry/contracts/layout'
import { settingsValueSpec } from '@src/registry/contracts/settings'
import {
  DRAWING_PROJECTION_DEBUG_AREA_TYPE,
  DRAWING_PROJECTION_DEBUG_PANE_ID,
  DRAWING_PROJECTION_DEBUG_PLUGIN_ID,
} from '@src/registry/plugins/drawingProjectionDebug/constants'
import { describe, expect, it } from 'vitest'
import drawingProjectionDebug from '.'

describe('drawing projection debug plugin', () => {
  it('contributes its layout area and pane only while enabled', () => {
    const registry = new Registry()
    registry.configure([drawingProjectionDebug])

    const [plugin] = registry.get(pluginsValueSpec)
    expect(plugin).toMatchObject({
      id: DRAWING_PROJECTION_DEBUG_PLUGIN_ID,
      title: 'Drawing projection debug',
    })

    const toggle = registry.get(plugin.service)
    expect(toggle.active.value).toBe(false)
    expect(
      registry
        .get(settingsValueSpec)
        .plugins[DRAWING_PROJECTION_DEBUG_PLUGIN_ID].createSetting().default
    ).toBe(false)
    expect(registry.get(layoutAreaLibraryValueSpec)).not.toHaveProperty(
      DRAWING_PROJECTION_DEBUG_AREA_TYPE
    )
    expect(registry.get(layoutContributionsValueSpec)).toEqual([])

    toggle.enable()

    expect(registry.get(layoutAreaLibraryValueSpec)).toHaveProperty(
      DRAWING_PROJECTION_DEBUG_AREA_TYPE
    )
    expect(registry.get(layoutContributionsValueSpec)).toEqual([
      expect.objectContaining({
        id: 'drawingProjectionDebug.right-toolbar.pane',
        kind: 'area',
        initiallyOpen: false,
        pane: {
          id: DRAWING_PROJECTION_DEBUG_PANE_ID,
          label: 'Drawing Projection',
          icon: 'bug',
          type: LayoutType.Simple,
          areaType: DRAWING_PROJECTION_DEBUG_AREA_TYPE,
        },
        placement: {
          targetPaneId: DefaultLayoutToolbarID.Right,
          position: 'end',
        },
      }),
    ])

    toggle.disable()

    expect(toggle.active.value).toBe(false)
    expect(registry.get(layoutAreaLibraryValueSpec)).not.toHaveProperty(
      DRAWING_PROJECTION_DEBUG_AREA_TYPE
    )
    expect(registry.get(layoutContributionsValueSpec)).toEqual([])
  })
})
