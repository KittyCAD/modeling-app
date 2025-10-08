import { type Layout } from '@src/lib/layout/types'

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
export const basicLayout: Layout = {
  id: crypto.randomUUID(),
  label: 'root',
  type: 'splits',
  orientation: 'inline',
  sizes: [30, 50, 20],
  children: [
    {
      id: crypto.randomUUID(),
      label: 'left-toolbar',
      type: 'panes',
      side: 'inline-start',
      activeIndices: [0, 2],
      sizes: [50, 50],
      splitOrientation: 'block',
      paneIcons: ['model', 'code', 'make-variable', 'logs'],
      children: [
        {
          id: crypto.randomUUID(),
          label: 'feature-tree',
          type: 'simple',
          areaType: 'featureTree',
        },
        {
          id: crypto.randomUUID(),
          label: 'code',
          type: 'simple',
          areaType: 'codeEditor',
        },
        {
          id: crypto.randomUUID(),
          label: 'variables',
          type: 'simple',
          areaType: 'variables',
        },
        {
          id: crypto.randomUUID(),
          label: 'logs',
          type: 'simple',
          areaType: 'logs',
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
      type: 'simple',
      areaType: 'modeling',
    },
    {
      id: crypto.randomUUID(),
      label: 'right-toolbar',
      type: 'panes',
      side: 'inline-end',
      activeIndices: [0],
      sizes: [100],
      splitOrientation: 'block',
      paneIcons: ['sparkles'],
      children: [
        {
          id: crypto.randomUUID(),
          label: 'ttc',
          type: 'simple',
          areaType: 'ttc',
        },
      ],
    },
  ],
}
