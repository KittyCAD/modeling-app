import type { DefaultPlanes } from '@rust/kcl-lib/bindings/DefaultPlanes'

// KCL string representation of default planes
export type DefaultPlaneStr = 'XY' | 'XZ' | 'YZ' | '-XY' | '-XZ' | '-YZ'

export function defaultPlaneStrToKey(
  plane: DefaultPlaneStr
): keyof DefaultPlanes | Error {
  switch (plane) {
    case 'XY':
      return 'xy'
    case 'XZ':
      return 'xz'
    case 'YZ':
      return 'yz'
    case '-XY':
      return 'negXy'
    case '-XZ':
      return 'negXz'
    case '-YZ':
      return 'negYz'
    default:
      return new Error(`Invalid plane string: ${plane}`)
  }
}

export function isDefaultPlaneStr(plane: string): plane is DefaultPlaneStr {
  return ['XY', 'XZ', 'YZ', '-XY', '-XZ', '-YZ'].includes(plane)
}
