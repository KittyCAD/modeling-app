import type { Layout } from '@src/lib/layout/types'

/**
 * The Playwright testing layout has:
 * - a left (in LTR languages) sidebar with:
 *   - Feature tree (open)
 *   - code
 *   - variables
 *   - debug
 *   - Zookeeper
 * - the modeling view
 */
export const playwrightLayoutConfig = {
  id: 'default',
  label: 'root',
  type: 'split',
  orientation: 'inline',
  /** Chosen merely to match existing snapshots as closely as possible */
  sizes: [46, 54],
  children: [
    {
      id: 'left-toolbar',
      label: 'left-toolbar',
      type: 'panes',
      side: 'inline-start',
      activeIndices: [1],
      sizes: [100],
      splitOrientation: 'block',
      children: [
        {
          id: 'feature-tree',
          label: 'Feature Tree',
          type: 'split',
          icon: 'model',
          sizes: [75, 25],
          orientation: 'block',
          children: [
            {
              id: 'operations-list',
              label: 'Feature Tree',
              type: 'simple',
              areaType: 'featureTree',
            },
            {
              id: 'bodies-list',
              label: 'Bodies List',
              type: 'simple',
              areaType: 'bodies',
            },
          ],
        },
        {
          id: 'code',
          label: 'Code Editor',
          type: 'simple',
          areaType: 'codeEditor',
          icon: 'code',
        },
        {
          id: 'files',
          label: 'Project Files',
          type: 'simple',
          areaType: 'files',
          icon: 'folder',
        },
        {
          id: 'variables',
          label: 'Variables',
          type: 'simple',
          areaType: 'variables',
          icon: 'make-variable',
        },
        {
          id: 'logs',
          label: 'Logs',
          type: 'simple',
          areaType: 'logs',
          icon: 'logs',
        },
        {
          id: 'debug',
          label: 'Debug',
          icon: 'bug',
          type: 'simple',
          areaType: 'debug',
        },
        {
          id: 'ttc',
          label: 'Zookeeper',
          type: 'simple',
          areaType: 'ttc',
          icon: 'sparkles',
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
      ],
    },
    {
      id: 'modeling-scene',
      label: 'Modeling scene',
      type: 'simple',
      areaType: 'modeling',
    },
  ],
} as unknown as Layout
