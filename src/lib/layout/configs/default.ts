import { isDesktop } from '@src/lib/isDesktop'
import {
  ActionType,
  AreaType,
  LayoutType,
  type Layout,
  type PaneLayout,
} from '@src/lib/layout/types'

/** Temporary ID for getting the left toolbar of the layout */
export enum DefaultLayoutToolbarID {
  Left = 'left-toolbar',
  Right = 'right-toolbar',
}

export enum DefaultLayoutPaneID {
  Debug = 'debug',
  Code = 'code',
  FeatureTree = 'feature-tree',
  Files = 'files',
  TTC = 'ttc',
  Variables = 'variables',
  Logs = 'logs',
}

export function isDefaultLayoutPaneID(s: string): s is DefaultLayoutPaneID {
  return Object.values(DefaultLayoutPaneID).includes(s as DefaultLayoutPaneID)
}

/**
 * Temporary config for the special debug pane we have in the app.
 */
export const debugPaneConfig: PaneLayout['children'][number] = {
  id: DefaultLayoutPaneID.Debug,
  label: 'Debug',
  icon: 'bug',
  type: LayoutType.Simple,
  areaType: AreaType.Debug,
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
  id: 'default',
  label: 'root',
  type: LayoutType.Splits,
  orientation: 'inline',
  sizes: [20, 50, 30],
  children: [
    {
      id: DefaultLayoutToolbarID.Left,
      label: 'left-toolbar',
      type: LayoutType.Panes,
      side: 'inline-start',
      activeIndices: isDesktop() ? [0, 2] : [0],
      sizes: isDesktop() ? [50, 50] : [100],
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
          label: 'Text-to-CAD',
          type: LayoutType.Simple,
          areaType: AreaType.TTC,
          icon: 'sparkles',
        },
      ],
    },
  ],
}
