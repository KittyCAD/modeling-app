import { ActionType, AreaType, LayoutType } from '@src/lib/layout/types'
import type { Layout } from '@src/lib/layout/types'
import {
  DefaultLayoutPaneID,
  DefaultLayoutToolbarID,
} from '@src/lib/layout/configs/default'

/**
 * The Playwright testing layout has:
 * - a left (in LTR languages) sidebar with:
 *   - Feature tree (open)
 *   - code
 *   - variables
 *   - debug
 *   - Text-to-CAD
 * - the modeling view
 */
export const playwrightLayoutConfig: Layout = {
  id: 'default',
  label: 'root',
  type: LayoutType.Splits,
  orientation: 'inline',
  /** Chosen merely to match existing snapshots as closely as possible */
  sizes: [46, 54],
  children: [
    {
      id: DefaultLayoutToolbarID.Left,
      label: 'left-toolbar',
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
          label: 'Code Editor',
          type: LayoutType.Simple,
          areaType: AreaType.Code,
          icon: 'code',
        },
        {
          id: DefaultLayoutPaneID.Files,
          label: 'Project Files',
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
        {
          id: DefaultLayoutPaneID.Logs,
          label: 'Logs',
          type: LayoutType.Simple,
          areaType: AreaType.Logs,
          icon: 'logs',
        },
        {
          id: DefaultLayoutPaneID.Debug,
          label: 'Debug',
          icon: 'bug',
          type: LayoutType.Simple,
          areaType: AreaType.Debug,
        },
        {
          id: DefaultLayoutPaneID.TTC,
          label: 'Text-to-CAD',
          type: LayoutType.Simple,
          areaType: AreaType.TTC,
          icon: 'sparkles',
        },
      ],
      actions: [
        {
          id: 'add-file-to-project',
          label: 'Add file to project',
          icon: 'importFile',
          actionType: ActionType.AddFile,
        },
        {
          id: 'export',
          label: 'Export part',
          icon: 'floppyDiskArrow',
          actionType: ActionType.Export,
        },
        {
          id: 'make',
          label: 'Make part',
          icon: 'printer3d',
          actionType: ActionType.Make,
        },
        {
          id: 'refresh',
          label: 'Refresh app',
          icon: 'exclamationMark',
          actionType: ActionType.Refresh,
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
}
