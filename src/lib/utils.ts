import { Range } from '../useStore'

export function isOverlapping(a: Range, b: Range) {
  const startingRange = a[0] < b[0] ? a : b
  const secondRange = a[0] < b[0] ? b : a
  return startingRange[1] >= secondRange[0]
}

export function roundOff(num: number, places: number = 2): number {
  const x = Math.pow(10, places)
  return Math.round(num * x) / x
}

export function getLength(a: [number, number], b: [number, number]): number {
  const x = b[0] - a[0]
  const y = b[1] - a[1]
  return Math.sqrt(x * x + y * y)
}

export function getAngle(a: [number, number], b: [number, number]): number {
  const x = b[0] - a[0]
  const y = b[1] - a[1]
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}
