import { SourceRange } from '../lang/executor'

export function isOverlap(a: SourceRange, b: SourceRange) {
  const [startingRange, secondRange] = a[0] < b[0] ? [a, b] : [b, a]
  const [lastOfFirst, firstOfSecond] = [startingRange[1], secondRange[0]]
  return lastOfFirst >= firstOfSecond
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
  return normaliseAngle((Math.atan2(y, x) * 180) / Math.PI)
}

export function normaliseAngle(angle: number): number {
  const result = ((angle % 360) + 360) % 360
  return result > 180 ? result - 360 : result
}

export function throttle(
  func: (...args: any[]) => any,
  wait: number
): (...args: any[]) => any {
  let timeout: ReturnType<typeof setTimeout> | null
  let latestArgs: any[]
  let latestTimestamp: number

  function later() {
    timeout = null
    func(...latestArgs)
  }

  function throttled(...args: any[]) {
    const currentTimestamp = Date.now()
    latestArgs = args

    if (!latestTimestamp || currentTimestamp - latestTimestamp >= wait) {
      latestTimestamp = currentTimestamp
      func(...latestArgs)
    } else if (!timeout) {
      timeout = setTimeout(later, wait - (currentTimestamp - latestTimestamp))
    }
  }

  return throttled
}
