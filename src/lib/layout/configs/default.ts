import { LayoutType, type Layout, type PaneLayout } from '@src/lib/layout/types'

/** Temporary ID for getting the left toolbar of the layout */
export const LEFT_TOOLBAR_ID = 'left-toolbar'
export const DEBUG_PANE_ID = 'debug'

/**
 * Temporary config for the special debug pane we have in the app.
 */
export const debugPaneConfig: PaneLayout['children'][number] = {
  id: DEBUG_PANE_ID,
  label: 'debug',
  icon: 'bug',
  type: LayoutType.Simple,
  areaType: 'debug',
}

/**
 * The default layout has:
 * - a left (in LTR languages) sidebar with:
 *   - Feature tree (open)
 *   - code
 *   - variables
 * - the modeling view
 * - a right (in LTR languages) sidebar with:
 *   - Text-to-CAD
 */
export const defaultLayoutConfig: Layout = {
  id: crypto.randomUUID(),
  label: 'root',
  type: LayoutType.Splits,
  orientation: 'inline',
  sizes: [30, 50, 20],
  children: [
    {
      id: LEFT_TOOLBAR_ID,
      label: 'left-toolbar',
      type: LayoutType.Panes,
      side: 'inline-start',
      activeIndices: [0, 2],
      sizes: [50, 50],
      splitOrientation: 'block',
      children: [
        {
          id: crypto.randomUUID(),
          label: 'feature-tree',
          type: LayoutType.Simple,
          areaType: 'featureTree',
          icon: 'model',
        },
        {
          id: crypto.randomUUID(),
          label: 'code',
          type: LayoutType.Simple,
          areaType: 'codeEditor',
          icon: 'code',
        },
        {
          id: crypto.randomUUID(),
          label: 'variables',
          type: LayoutType.Simple,
          areaType: 'variables',
          icon: 'make-variable',
        },
        {
          id: crypto.randomUUID(),
          label: 'Logs',
          type: LayoutType.Simple,
          areaType: 'logs',
          icon: 'logs',
        },
      ],
      actions: [
        {
          id: crypto.randomUUID(),
          label: 'Add file to project',
          icon: 'importFile',
          actionType: 'addFileToProject',
        },
        {
          id: crypto.randomUUID(),
          label: 'Export part',
          icon: 'floppyDiskArrow',
          actionType: 'export',
        },
        {
          id: crypto.randomUUID(),
          label: 'Make part',
          icon: 'printer3d',
          actionType: 'make',
        },
        {
          id: crypto.randomUUID(),
          label: 'Refresh app',
          icon: 'exclamationMark',
          actionType: 'refreshApp',
        },
      ],
    },
    {
      id: crypto.randomUUID(),
      label: 'modeling-scene',
      type: LayoutType.Simple,
      areaType: 'modeling',
    },
    {
      id: crypto.randomUUID(),
      label: 'right-toolbar',
      type: LayoutType.Panes,
      side: 'inline-end',
      activeIndices: [0],
      sizes: [],
      splitOrientation: 'block',
      children: [
        {
          id: crypto.randomUUID(),
          label: 'ttc',
          type: LayoutType.Simple,
          areaType: 'ttc',
          icon: 'sparkles',
        },
      ],
    },
  ],
}
