import type { Layout } from '@src/lib/layout/types'

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
  id: 'basic',
  label: 'root',
  type: 'splits',
  orientation: 'inline',
  sizes: [30, 50, 20],
  children: [
    {
      id: 'b',
      label: 'left-toolbar',
      type: 'panes',
      side: 'block-start',
      activeIndices: [0, 2],
      sizes: [50, 50],
      children: [
        {
          id: 'c',
          label: 'feature-tree',
          type: 'simple',
          areaType: 'featureTree',
          icon: 'model',
        },
        {
          id: 'd',
          label: 'code',
          type: 'simple',
          areaType: 'codeEditor',
          icon: 'code',
        },
        {
          id: 'e',
          label: 'variables',
          type: 'simple',
          areaType: 'variables',
          icon: 'make-variable',
        },
        {
          id: crypto.randomUUID(),
          label: 'logs',
          type: 'simple',
          areaType: 'logs',
          icon: 'logs',
        },
      ],
      actions: [
        {
          id: 'add-file-to-project',
          label: 'Add file to project',
          icon: 'importFile',
          actionType: 'addFileToProject',
        },
        {
          id: 'export',
          label: 'Export part',
          icon: 'floppyDiskArrow',
          actionType: 'export',
        },
        {
          id: 'make',
          label: 'Make part',
          icon: 'printer3d',
          actionType: 'make',
        },
        {
          id: 'refresh',
          label: 'Refresh app',
          icon: 'exclamationMark',
          actionType: 'refreshApp',
        },
      ],
    },
    {
      id: 'f',
      label: 'modeling-scene',
      type: 'simple',
      areaType: 'modeling',
    },
    {
      id: 'g',
      label: 'right-toolbar',
      type: 'panes',
      side: 'inline-end',
      activeIndices: [0],
      sizes: [],
      children: [
        {
          id: 'h',
          label: 'ttc',
          type: 'simple',
          areaType: 'ttc',
          icon: 'sparkles',
        },
      ],
    },
  ],
}
