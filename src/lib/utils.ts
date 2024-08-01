import { SourceRange } from '../lang/wasm'

import { v4 } from 'uuid'

export const uuidv4 = v4

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

/**
 * Calculates the angle in degrees between two points in a 2D space.
 * The angle is normalized to the range [-180, 180].
 *
 * @param a The first point as a tuple [x, y].
 * @param b The second point as a tuple [x, y].
 * @returns The normalized angle in degrees between point a and point b.
 */
export function getAngle(a: [number, number], b: [number, number]): number {
  const x = b[0] - a[0]
  const y = b[1] - a[1]
  return normaliseAngle((Math.atan2(y, x) * 180) / Math.PI)
}

/**
 * Normalizes an angle to the range [-180, 180].
 *
 * This function takes an angle in degrees and normalizes it so that the result is always within the range of -180 to 180 degrees. This is useful for ensuring consistent angle measurements where the direction (positive or negative) is significant.
 *
 * @param angle The angle in degrees to be normalized.
 * @returns The normalized angle in the range [-180, 180].
 */
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

// takes a function and executes it after the wait time, if the function is called again before the wait time is up, the timer is reset
export function deferExecution<T>(func: (args: T) => any, wait: number) {
  let timeout: ReturnType<typeof setTimeout> | null
  let latestArgs: T

  function later() {
    timeout = null
    func(latestArgs)
  }

  function deferred(args: T) {
    latestArgs = args
    if (timeout) {
      clearTimeout(timeout)
    }
    timeout = setTimeout(later, wait)
  }

  return deferred
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

export function isReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia &&
    // TODO/Note I (Kurt) think '(prefers-reduced-motion: reduce)' and '(prefers-reduced-motion)' are equivalent, but not 100% sure
    window.matchMedia('(prefers-reduced-motion)').matches
  )
}

export function XOR(bool1: boolean, bool2: boolean): boolean {
  return (bool1 || bool2) && !(bool1 && bool2)
}
