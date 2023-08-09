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

export function throttle<T>(
  func: (args: T) => any,
  wait: number
): (args: T) => any {
  let timeout: ReturnType<typeof setTimeout> | null
  let latestArgs: T
  let latestTimestamp: number

  function later() {
    timeout = null
    func(latestArgs)
  }

  function throttled(args: T) {
    const currentTimestamp = Date.now()
    latestArgs = args

    if (!latestTimestamp || currentTimestamp - latestTimestamp >= wait) {
      latestTimestamp = currentTimestamp
      func(latestArgs)
    } else if (!timeout) {
      timeout = setTimeout(later, wait - (currentTimestamp - latestTimestamp))
    }
  }

  return throttled
}

export function getNormalisedCoordinates({
  clientX,
  clientY,
  streamWidth,
  streamHeight,
  el,
}: {
  clientX: number
  clientY: number
  streamWidth: number
  streamHeight: number
  el: HTMLElement
}) {
  const { left, top, width, height } = el?.getBoundingClientRect()
  const browserX = clientX - left
  const browserY = clientY - top
  return {
    x: Math.round((browserX / width) * streamWidth),
    y: Math.round((browserY / height) * streamHeight),
  }
}
