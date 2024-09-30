import { SourceRange } from '../lang/wasm'

import { v4 } from 'uuid'
import { isDesktop } from './isDesktop'
import { AnyMachineSnapshot } from 'xstate'
import { AsyncFn } from './types'

export const uuidv4 = v4

/**
 * A safer type guard for arrays since the built-in Array.isArray() asserts `any[]`.
 */
export function isArray(val: any): val is unknown[] {
  return Array.isArray(val)
}

/**
 * An alternative to `Object.keys()` that returns an array of keys with types.
 *
 * It's UNSAFE because because of TS's structural subtyping and how at runtime, you can
 * extend a JS object with whatever keys you want.
 *
 * Why we shouldn't be extending objects with arbitrary keys at run time, the structural subtyping
 * issue could be a confusing bug, for example, in the below snippet `myKeys` is typed as
 * `('x' | 'y')[]` but is really `('x' | 'y' | 'name')[]`
 * ```ts
 * interface Point { x: number; y: number }
 * interface NamedPoint { x: number; y: number; name: string }
 *
 * let point: Point = { x: 1, y: 2 }
 * let namedPoint: NamedPoint = { x: 1, y: 2, name: 'A' }
 *
 * // Structural subtyping allows this assignment
 * point = namedPoint  // This is allowed because NamedPoint has all properties of Point
 * const myKeys = unsafeTypedKeys(point) // typed as ('x' | 'y')[] but is really ('x' | 'y' | 'name')[]
 * ```
 */
export function unsafeTypedKeys<T extends object>(obj: T): Array<keyof T> {
  return Object.keys(obj) as Array<keyof T>
}
/*
 * Predicate that checks if a value is not null and not undefined.  This is
 * useful for functions like Array::filter() and Array::find() that have
 * overloads that accept a type guard.
 */
export function isNonNullable<T>(val: T): val is NonNullable<T> {
  return val !== null && val !== undefined
}

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

/**
 * Wrap an async function so that it can be called in a sync context, catching
 * rejections.
 *
 * It's common to want to run an async function in a sync context, like an event
 * handler or callback.  But we want to catch errors.
 *
 * Note: The returned function doesn't block.  This isn't magic.
 *
 * @param onReject This callback type is from Promise.prototype.catch.
 */
export function toSync<F extends AsyncFn<F>>(
  fn: F,
  onReject: (
    reason: any
  ) => void | PromiseLike<void | null | undefined> | null | undefined
): (...args: Parameters<F>) => void {
  return (...args: Parameters<F>) => {
    fn(...args).catch(onReject)
  }
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

// TODO: Remove the empty platform type.
export type Platform = 'macos' | 'windows' | 'linux' | ''

export function platform(): Platform {
  if (isDesktop()) {
    const platform = window.electron.platform ?? ''
    // https://nodejs.org/api/process.html#processplatform
    switch (platform) {
      case 'darwin':
        return 'macos'
      case 'win32':
        return 'windows'
      // We don't currently care to distinguish between these.
      case 'android':
      case 'freebsd':
      case 'linux':
      case 'openbsd':
      case 'sunos':
        return 'linux'
      default:
        console.error('Unknown desktop platform:', platform)
        return ''
    }
  }

  // navigator.platform is deprecated, but many browsers still support it, and
  // it's more accurate than userAgent and userAgentData in Playwright.
  if (
    navigator.platform?.indexOf('Mac') === 0 ||
    navigator.platform?.indexOf('iPhone') === 0 ||
    navigator.platform?.indexOf('iPad') === 0 ||
    // Vite tests running in HappyDOM.
    navigator.platform?.indexOf('Darwin') >= 0
  ) {
    return 'macos'
  }
  if (navigator.platform === 'Windows' || navigator.platform === 'Win32') {
    return 'windows'
  }

  // Chrome only, but more accurate than userAgent.
  let userAgentDataPlatform: unknown
  if (
    'userAgentData' in navigator &&
    navigator.userAgentData &&
    typeof navigator.userAgentData === 'object' &&
    'platform' in navigator.userAgentData
  ) {
    userAgentDataPlatform = navigator.userAgentData.platform
    if (userAgentDataPlatform === 'macOS') return 'macos'
    if (userAgentDataPlatform === 'Windows') return 'windows'
  }

  if (navigator.userAgent.indexOf('Mac') !== -1) {
    return 'macos'
  } else if (navigator.userAgent.indexOf('Win') !== -1) {
    return 'windows'
  } else if (navigator.userAgent.indexOf('Linux') !== -1) {
    return 'linux'
  }
  console.error(
    'Unknown web platform:',
    navigator.platform,
    userAgentDataPlatform,
    navigator.userAgent
  )
  return ''
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

export function getActorNextEvents(snapshot: AnyMachineSnapshot) {
  return [...new Set([...snapshot._nodes.flatMap((sn) => sn.ownEvents)])]
}
