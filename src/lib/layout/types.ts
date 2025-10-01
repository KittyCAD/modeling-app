import type { CustomIconName } from '@src/components/CustomIcon'
import type { ReactNode } from 'react'

type BasicArea = {
  id: string
  label: string
}
type WithChildren = { children: Layout[] }
export type Orientation = 'inline' | 'block'
export type StartEnd = 'start' | 'end'
export type Side = `${Orientation}-${StartEnd}`
type WithOrientation = { orientation: Orientation }
type WithSide = {
  side: Side
}

type SplitArea = BasicArea &
  WithChildren &
  WithOrientation & {
    type: 'splits'
    /** sizes.length must equal children.length */
    sizes: number[]
  }
type TabArea = BasicArea &
  WithChildren & {
    type: 'tabs'
    activeIndex: number
  }
type ToolbarArea = BasicArea &
  WithChildren &
  WithSide & {
    type: 'toolbar'
    activeIndices: number[]
    children: (Layout & {
      icon: CustomIconName
    })[]
  }
type LeafArea = BasicArea & {
  type: 'simple'
  component: ReactNode
}
export type Layout = LeafArea | SplitArea | TabArea | ToolbarArea
