import type { CustomIconName } from '@src/components/CustomIcon'
import type { MouseEventHandler, useMemo } from 'react'

export enum AreaType {
  TTC = 'ttc',
  Code = 'codeEditor',
  FeatureTree = 'featureTree',
  Files = 'files',
  Variables = 'variables',
  Logs = 'logs',
  ModelingScene = 'modeling',
  Debug = 'debug',
  History = 'history',
  Diff = 'diff',
}

export type AreaTypeComponentProps = {
  areaConfig: Omit<AreaTypeDefinition, 'Component'>
  layout: Layout
} & Partial<Closeable>

/**
 * A registered areaType that can be used for a SimpleLayout.
 * This is where all "real" custom UI gets defined, in the `Component` property.
 */
export type AreaTypeDefinition = {
  hide: () => boolean
  shortcut?: string
  /** I decided this is where impure stuff like the TTC button's custom styling should live */
  cssClassOverrides?: PaneChildCssOverrides
  useNotifications?: () => ReturnType<
    typeof useMemo<
      | {
          value: string | number
          onClick: MouseEventHandler
          title?: string
        }
      | undefined
    >
  >
  Component: React.FC<AreaTypeComponentProps>
}

export enum ActionType {
  Export = 'export',
  AddFile = 'addFileToProject',
  Make = 'make',
}

export type ActionTypeDefinition = {
  execute: () => void
  /** A custom hook for the Action to detect if it should be enabled */
  useDisabled?: () => string | undefined
  shortcut?: string
  useHidden?: () => boolean
}

export enum LayoutType {
  Splits = 'split',
  // @TODO: bring the tabs type back when we need it for file buffers, etc
  // Tabs = 'tabs',
  Panes = 'panes',
  Simple = 'simple',
}

type HasIdAndLabel = {
  id: string // uuid
  label: string
}
export type BaseLayout = HasIdAndLabel & {
  type: LayoutType
}
type WithChildren = { children: Layout[] }
export type Direction = 'horizontal' | 'vertical'
export type Orientation = 'inline' | 'block'
export type StartEnd = 'start' | 'end'
export type Side = `${Orientation}-${StartEnd}`
type WithOrientation = { orientation: Orientation }
type WithSide = {
  side: Side
}
type WithSizes = { sizes: number[] }
type WithIcon = {
  icon: CustomIconName
}

export type SplitLayout = BaseLayout &
  WithChildren &
  WithSizes &
  WithOrientation & {
    type: LayoutType.Splits
  }
export type Action = HasIdAndLabel &
  WithIcon & {
    actionType: ActionType
  }
export type PaneChild = Layout & WithIcon
export type PaneChildCssOverrides = Partial<{
  button: string
  // Could add pane, etc here
}>

export type PaneLayout = BaseLayout &
  WithSizes &
  WithSide & {
    type: LayoutType.Panes
    activeIndices: number[]
    children: PaneChild[]
    splitOrientation: Orientation
    actions?: Action[]
    /** if the pane layout is a split layout's child in the same axis, it will onExpandSize
     * when it goes from 0 to 1 active child panes
     */
    onExpandSize?: number
  }
export interface Closeable {
  onClose: () => void
}
export type SimpleLayout = BaseLayout & {
  type: LayoutType.Simple
  areaType: AreaType
}
export type Layout = SimpleLayout | SplitLayout | PaneLayout

type LayoutVersion = `v${number}`

/** add more fields as needed */
export type LayoutWithMetadata = {
  version: LayoutVersion
  /** We don't know if this is valid yet */
  layout: Layout
}

export type LayoutMigrationMap = Map<string, LayoutMigration>

export type LayoutMigration = {
  newVersion: string
  transformationSets: LayoutTransformationSet[]
}

type LayoutTransformationSet = {
  /** A matcher to either match on all (if `true`) or some layout nodes */
  matcher: LayoutMatcher
  /** The transformations to apply to the matched layout node */
  transformations: LayoutTransformation[]
}

export type LayoutMatcher = true | ((l: Layout) => boolean)
export type LayoutTransformation = (l: Layout) => null | Layout
