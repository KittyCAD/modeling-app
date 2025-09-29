import type { CustomIconName } from '@src/components/CustomIcon'
import type { ReactNode } from 'react'

type BasicArea = {
  id: string
  label: string
}
type WithChildren = { children: Layout[] }
type Orientation = 'inline' | 'block'
type StartEnd = 'start' | 'end'
type Side = `${Orientation}-${StartEnd}`
type WithOrientation = { orientation: Orientation }
type WithSide = {
  side: Side
}

type SplitArea = BasicArea &
  WithChildren &
  WithOrientation & {
    type: 'splits'
    splitPoints: number[]
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
