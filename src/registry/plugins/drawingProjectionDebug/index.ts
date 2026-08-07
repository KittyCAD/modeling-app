import { defineRegistryItem, provide } from '@kittycad/registry'
import { DefaultLayoutToolbarID } from '@src/lib/layout/configs/default'
import { type AreaTypeComponentProps, LayoutType } from '@src/lib/layout/types'
import {
  layoutAreaLibraryValueSpec,
  layoutContributionsValueSpec,
} from '@src/registry/contracts/layout'
import { createZdsPlugin } from '@src/registry/createZdsPlugin'
import {
  DRAWING_PROJECTION_DEBUG_AREA_TYPE,
  DRAWING_PROJECTION_DEBUG_PANE_ID,
  DRAWING_PROJECTION_DEBUG_PLUGIN_ID,
} from '@src/registry/plugins/drawingProjectionDebug/constants'
import { createElement, lazy, Suspense } from 'react'

// Plugins are imported during registry boot; keep UI dependencies lazy.
const DrawingProjectionDebugPane = lazy(async () => {
  const { DrawingProjectionDebugPane } = await import(
    '@src/registry/plugins/drawingProjectionDebug/DrawingProjectionDebugPane'
  )
  return { default: DrawingProjectionDebugPane }
})

const DrawingProjectionDebugPaneArea = (_props: AreaTypeComponentProps) =>
  createElement(
    Suspense,
    { fallback: null },
    createElement(DrawingProjectionDebugPane)
  )

const drawingProjectionDebugLayout = defineRegistryItem({
  id: 'drawingProjectionDebug.layout',
  provides: [
    provide(layoutAreaLibraryValueSpec, {
      [DRAWING_PROJECTION_DEBUG_AREA_TYPE]: {
        hide: () => false,
        Component: DrawingProjectionDebugPaneArea,
      },
    }),
    provide(layoutContributionsValueSpec, {
      id: 'drawingProjectionDebug.right-toolbar.pane',
      kind: 'area',
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
      initiallyOpen: false,
    }),
  ],
})

const drawingProjectionDebug = createZdsPlugin({
  id: DRAWING_PROJECTION_DEBUG_PLUGIN_ID,
  title: 'Drawing projection debug',
  description:
    'Adds an opt-in pane for sending drawing projection tracer bullet commands.',
  items: [drawingProjectionDebugLayout],
  defaultSetting: 'off',
})

export const order = 40
export default drawingProjectionDebug
