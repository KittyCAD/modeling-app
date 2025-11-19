import {
  type Layout,
  LayoutType,
  AreaType,
  ActionType,
} from '@src/lib/layout/types'
import {
  DefaultLayoutToolbarID,
  DefaultLayoutPaneID,
} from '@src/lib/layout/configs/default'

/**
 * This predefined layout is meant for users to
 * focus on the Zookeeper experience
 * with a 50/50 split between the modeling scene
 * and the TTC pane.
 */
export const textToCADFocusConfig: Layout = {
  id: 'default',
  label: 'root',
  type: LayoutType.Splits,
  orientation: 'inline',
  sizes: [0, 50, 50],
  children: [
    {
      id: DefaultLayoutToolbarID.Left,
      label: 'left-toolbar',
      type: LayoutType.Panes,
      side: 'inline-start',
      activeIndices: [],
      sizes: [],
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
          areaType: AreaType.TTC,
          icon: 'sparkles',
        },
      ],
    },
  ],
}
