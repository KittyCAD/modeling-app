import { SourceRange } from 'lang/wasm'

export type Axis = 'y-axis' | 'x-axis' | 'z-axis'

export type Selection = {
  type:
    | 'default'
    | 'line-end'
    | 'line-mid'
    | 'face'
    | 'point'
    | 'edge'
    | 'line'
    | 'arc'
    | 'all'
  range: SourceRange
}
export type Selections = {
  otherSelections: Axis[]
  codeBasedSelections: Selection[]
}

export interface SelectionRangeTypeMap {
  [key: number]: Selection['type']
}
