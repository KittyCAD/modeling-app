import type { Binary as BSONBinary } from 'bson'
import { v4 } from 'uuid'
import type { AnyMachineSnapshot } from 'xstate'

import type { CallExpressionKw, SourceRange } from '@src/lang/wasm'
import { isDesktop } from '@src/lib/isDesktop'
import type { AsyncFn } from '@src/lib/types'

import * as THREE from 'three'

import type { EngineCommandManager } from '@src/lang/std/engineConnection'
import type {
  CameraViewState_type,
  UnitLength_type,
} from '@kittycad/lib/dist/types/src/models'

export const uuidv4 = v4

/**
 * Refresh the browser page after reporting to Plausible.
 */
export async function refreshPage(method = 'UI button') {
  if (window && 'plausible' in window) {
    const p = window.plausible as (
      event: string,
      options?: { props: Record<string, string> }
    ) => Promise<void>
    // Send a refresh event to Plausible so we can track how often users get stuck
    await p('Refresh', {
      props: {
        method,
        // optionally add more data here
      },
    })
  }

  // Window may not be available in some environments
  window?.location.reload()
}

/**
 * Get all labels for a keyword call expression.
 */
export function allLabels(callExpression: CallExpressionKw): string[] {
  return callExpression.arguments.map((a) => a.label.name)
}

/**
 * A safer type guard for arrays since the built-in Array.isArray() asserts `any[]`.
 */
export function isArray(val: any): val is unknown[] {
  // eslint-disable-next-line no-restricted-syntax
  return Array.isArray(val)
}

export type SafeArray<T> = Omit<Array<T>, number> & {
  [index: number]: T | undefined
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
    void fn(...args).catch((...args) => {
      console.error(...args)
      return onReject(...args)
    })
  }
}

export function getNormalisedCoordinates(
  e: PointerEvent | React.MouseEvent<HTMLDivElement, MouseEvent>,
  elVideo: HTMLVideoElement,
  streamDimensions: {
    width: number
    height: number
  }
) {
  const { left, top, width, height } = elVideo?.getBoundingClientRect()
  const browserX = e.clientX - left
  const browserY = e.clientY - top
  return {
    x: Math.round((browserX / width) * streamDimensions.width),
    y: Math.round((browserY / height) * streamDimensions.height),
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

export const onMouseDragRegex = /-?\.?\b\d+\.?\d*\b/g

export function simulateOnMouseDragMatch(text: string) {
  return text.match(onMouseDragRegex)
}

export function roundOff(num: number, precision: number = 2): number {
  const x = Math.pow(10, precision)
  return Math.round(num * x) / x
}

/**
 * Determine if the number as a string has any precision in the decimal places
 * '1' -> 0
 * '1.0' -> 1
 * '1.01' -> 2
 */
function getPrecision(text: string): number {
  const wholeFractionSplit = text.split('.')
  const precision =
    wholeFractionSplit.length === 2 ? wholeFractionSplit[1].split('').length : 0
  return precision
}

/**
 * Determines if a number string has a leading digit
 * 0.1 -> yes
 * -0.1 -> yes
 * .1 -> no
 * 10.1 -> no
 * The text.split('.') should evaluate to ['','<decimals>']
 */
export function hasLeadingZero(text: string): boolean {
  const wholeFractionSplit = text.split('.')
  return wholeFractionSplit.length === 2
    ? wholeFractionSplit[0] === '0' || wholeFractionSplit[0] === '-0'
    : false
}

export function hasDigitsLeftOfDecimal(text: string): boolean | undefined {
  const wholeFractionSplit = text.split('.')

  if (wholeFractionSplit.length === 2) {
    const wholeNumber = wholeFractionSplit[0]

    if (wholeNumber.length === 0) {
      return false
    } else {
      return true
    }
  }

  if (wholeFractionSplit.length === 1) {
    return true
  }

  // What if someone passes in 1..2.3.1...1.1.43
  return undefined
}

export function onDragNumberCalculation(text: string, e: MouseEvent) {
  const multiplier =
    e.shiftKey && e.metaKey ? 0.01 : e.metaKey ? 0.1 : e.shiftKey ? 10 : 1

  const delta = e.movementX * multiplier
  const hasPeriod = text.includes('.')
  const leadsWithZero = hasLeadingZero(text)
  const addition = Number(text) + delta
  const positiveAddition = e.movementX > 0
  const negativeAddition = e.movementX < 0
  const containsDigitsLeftOfDecimal = hasDigitsLeftOfDecimal(text)
  let precision = Math.max(
    getPrecision(text),
    getPrecision(multiplier.toString())
  )
  const newVal = roundOff(addition, precision)

  if (Number.isNaN(newVal)) {
    return
  }

  let formattedString = newVal.toString()
  if (hasPeriod && !formattedString.includes('.')) {
    // If the original number included a period lets add that back to the output string
    // e.g. '1.0' add +1 then we get 2, we want to send '2.0' back since the original one had a decimal place
    formattedString = formattedString.toString() + '.0'
  }

  /**
   * Whenever you add two numbers you can always remove the the leading zero the result will make sense
   * 1 + -0.01 = 0.99, the code would remove the leading 0 to make it .99 but since the number has a
   * digit left of the decimal to begin with I want to make it 0.99.
   * negativeAddition with fractional numbers will provide a leading 0.
   */
  const removeZeros =
    positiveAddition ||
    (negativeAddition && multiplier < 1 && !containsDigitsLeftOfDecimal)

  /**
   * If the original value has no leading 0
   * If if the new updated value has a leading zero
   * If the math operation means you can actually remove the zero.
   */
  if (!leadsWithZero && hasLeadingZero(formattedString) && removeZeros) {
    if (formattedString[0] === '-') {
      return ['-', formattedString.split('.')[1]].join('.')
    } else {
      return formattedString.substring(1)
    }
  }

  return formattedString
}

export function onMouseDragMakeANewNumber(
  text: string,
  setText: (t: string) => void,
  e: MouseEvent
) {
  const newVal = onDragNumberCalculation(text, e)
  if (!newVal) return
  setText(newVal)
}

export function isClockwise(points: [number, number][]): boolean {
  // Need at least 3 points to determine orientation
  if (points.length < 3) {
    return false
  }

  // Calculate the sum of (x2 - x1) * (y2 + y1) for all edges
  // This is the "shoelace formula" for calculating the signed area
  let sum = 0
  for (let i = 0; i < points.length; i++) {
    const current = points[i]
    const next = points[(i + 1) % points.length]
    sum += (next[0] - current[0]) * (next[1] + current[1])
  }

  // If sum is positive, the points are in clockwise order
  return sum > 0
}

/** Capitalise a string's first character */
export function capitaliseFC(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1)
}

/**
 * Converts a binary buffer to a UUID string.
 *
 * @param buffer - The binary buffer containing the UUID bytes.
 * @returns A string representation of the UUID in the format 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'.
 */
export function binaryToUuid(
  binaryData: Buffer | Uint8Array | BSONBinary | string
): string {
  if (typeof binaryData === 'string') {
    return binaryData
  }

  let buffer: Uint8Array

  // Handle MongoDB BSON Binary object
  if (
    binaryData &&
    '_bsontype' in binaryData &&
    binaryData._bsontype === 'Binary'
  ) {
    // Extract the buffer from the BSON Binary object
    buffer = binaryData.buffer
  }
  // Handle case where buffer property exists (some MongoDB drivers structure)
  else if (binaryData && binaryData.buffer instanceof Uint8Array) {
    buffer = binaryData.buffer
  }
  // Handle direct Buffer or Uint8Array
  else if (binaryData instanceof Uint8Array || Buffer.isBuffer(binaryData)) {
    buffer = binaryData
  } else {
    console.error(
      'Invalid input type: expected MongoDB BSON Binary, Buffer, or Uint8Array'
    )
    return ''
  }

  // Ensure we have exactly 16 bytes (128 bits) for a UUID
  if (buffer.length !== 16) {
    // For debugging
    console.log('Buffer length:', buffer.length)
    console.log('Buffer content:', Array.from(buffer))
    console.error('UUID must be exactly 16 bytes')
    return ''
  }

  // Convert each byte to a hex string and pad with zeros if needed
  const hexValues = Array.from(buffer).map((byte) =>
    byte.toString(16).padStart(2, '0')
  )

  // Format into UUID structure (8-4-4-4-12 characters)
  return [
    hexValues.slice(0, 4).join(''),
    hexValues.slice(4, 6).join(''),
    hexValues.slice(6, 8).join(''),
    hexValues.slice(8, 10).join(''),
    hexValues.slice(10, 16).join(''),
  ].join('-')
}

export function getModuleId(sourceRange: SourceRange) {
  return sourceRange[2]
}

export function getInVariableCase(name: string, prefixIfDigit = 'm') {
  // As of 2025-04-08, standard case for KCL variables is camelCase
  const startsWithANumber = !Number.isNaN(Number(name.charAt(0)))
  const paddedName = startsWithANumber ? `${prefixIfDigit}${name}` : name

  // From https://www.30secondsofcode.org/js/s/string-case-conversion/#word-boundary-identification
  const r = /[A-Z]{2,}(?=[A-Z][a-z]+[0-9]*|\b)|[A-Z]?[a-z]+[0-9]*|[A-Z]|[0-9]+/g
  const boundaryIdentification = paddedName.match(r)
  if (!boundaryIdentification) {
    return undefined
  }

  const likelyPascalCase = boundaryIdentification
    .map((x) => x.slice(0, 1).toUpperCase() + x.slice(1).toLowerCase())
    .join('')
  if (!likelyPascalCase) {
    return undefined
  }

  return likelyPascalCase.slice(0, 1).toLowerCase() + likelyPascalCase.slice(1)
}

export function computeIsometricQuaternionForEmptyScene() {
  // Create the direction vector you want to look from
  const isoDir = new THREE.Vector3(1, 1, 1).normalize() // isometric look direction

  // Target is the point you want to look at (e.g., origin)
  const target = new THREE.Vector3(0, 0, 0)

  // Compute quaternion for isometric view
  const up = new THREE.Vector3(0, 0, 1) // default up direction
  const quaternion = new THREE.Quaternion()
  quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), isoDir) // align -Z with isoDir

  // Align up vector using a lookAt matrix
  const m = new THREE.Matrix4()
  m.lookAt(new THREE.Vector3().addVectors(target, isoDir), target, up)
  quaternion.setFromRotationMatrix(m)
  return quaternion
}

export async function engineStreamZoomToFit({
  engineCommandManager,
  padding,
}: {
  engineCommandManager: EngineCommandManager
  padding: number
}) {
  // It makes sense to also call zoom to fit here, when a new file is
  // loaded for the first time, but not overtaking the work kevin did
  // so the camera isn't moving all the time.
  await engineCommandManager.sendSceneCommand({
    type: 'modeling_cmd_req',
    cmd_id: uuidv4(),
    cmd: {
      type: 'zoom_to_fit',
      object_ids: [], // leave empty to zoom to all objects
      padding, // padding around the objects
      animated: false, // don't animate the zoom for now
    },
  })
}

export async function engineViewIsometricWithGeometryPresent({
  engineCommandManager,
  padding,
}: {
  engineCommandManager: EngineCommandManager
  padding: number
}) {
  /**
   * Default all users to view_isometric when loading into the engine.
   * This works for perspective projection and orthographic projection
   * This does not change the projection of the camera only the view direction which makes
   * it safe to use with either projection defaulted
   */
  await engineCommandManager.sendSceneCommand({
    type: 'modeling_cmd_req',
    cmd_id: uuidv4(),
    cmd: {
      type: 'view_isometric',
      padding, // padding around the objects
    },
  })

  /**
   * HACK: We need to update the gizmo, the command above doesn't trigger gizmo
   * to render which makes the axis point in an old direction.
   */
  await engineCommandManager.sendSceneCommand({
    type: 'modeling_cmd_req',
    cmd_id: uuidv4(),
    cmd: {
      type: 'default_camera_get_settings',
    },
  })
}

export async function engineViewIsometricWithoutGeometryPresent({
  engineCommandManager,
  unit,
}: {
  engineCommandManager: EngineCommandManager
  unit?: UnitLength_type
}) {
  // If you load an empty scene with any file unit it will have an eye offset of this
  const MAGIC_ENGINE_EYE_OFFSET = 1378.0057
  const quat = computeIsometricQuaternionForEmptyScene()
  const isometricView: CameraViewState_type = {
    pivot_rotation: {
      x: quat.x,
      y: quat.y,
      z: quat.z,
      w: quat.w,
    },
    pivot_position: {
      x: 0,
      y: 0,
      z: 0,
    },
    eye_offset: MAGIC_ENGINE_EYE_OFFSET,
    fov_y: 45,
    ortho_scale_factor: 1.4063792,
    is_ortho: true,
    ortho_scale_enabled: true,
    world_coord_system: 'right_handed_up_z',
  }
  await engineCommandManager.sendSceneCommand({
    type: 'modeling_cmd_req',
    cmd_id: uuidv4(),
    cmd: {
      type: 'default_camera_set_view',
      view: {
        ...isometricView,
      },
    },
  })

  /**
   * HACK: We need to update the gizmo, the command above doesn't trigger gizmo
   * to render which makes the axis point in an old direction.
   */
  await engineCommandManager.sendSceneCommand({
    type: 'modeling_cmd_req',
    cmd_id: uuidv4(),
    cmd: {
      type: 'default_camera_get_settings',
    },
  })
}
