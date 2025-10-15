import type { CustomIconName } from '@src/components/CustomIcon'
import type { areaTypeRegistry } from '@src/lib/layout/areaTypeRegistry'
import type { actionTypeRegistry } from '@src/lib/layout/actionTypeRegistry'

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
    actionType: keyof typeof actionTypeRegistry
  }
export type PaneChild = Layout & WithIcon
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
  areaType: keyof typeof areaTypeRegistry
}
export type Layout = SimpleLayout | SplitLayout | PaneLayout

/** add more fields as needed */
export type LayoutWithMetadata = {
  version: 'v1'
  /** We don't know if this is valid yet */
  layout: Layout
}
