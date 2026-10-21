import type { Node } from '@rust/kcl-lib/bindings/Node'
import type { NamedView } from '@rust/kcl-lib/bindings/NamedView'
import type { NumericSuffix } from '@rust/kcl-lib/bindings/NumericSuffix'

import {
  createArrayExpression,
  createCallExpressionStdLibKw,
  createIdentifier,
  createLabeledArg,
  createLiteral,
  createLocalName,
} from '@src/lang/create'
import { setCallInAst } from '@src/lang/modifyAst'
import { traverse } from '@src/lang/queryAst'
import { KCL_DEFAULT_VIEW_NAME } from '@src/lang/std/kclNamedViews'
import type { CallExpressionKw, PathToNode, Program } from '@src/lang/wasm'
import { err } from '@src/lib/trap'
import { roundOff } from '@src/lib/utils'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'

type Vec3 = [number, number, number]

/**
 * A camera as `view::directed()` takes it: where the camera looks and from
 * which direction, rather than a snapshot of engine camera state.
 */
export type DirectedCamera = {
  direction: Vec3
  up: Vec3
  /** Millimeters. */
  target: Vec3
  /** Millimeters. Absent when the saved camera has no usable distance. */
  distance: number | undefined
  projection: 'orthographic' | 'perspective'
}

/** Decimals kept for directions and millimeter lengths. */
const PRECISION = 4

/** Rotates `v` by the unit quaternion `q`, given as `[x, y, z, w]`. */
function rotate(q: NamedView['pivot_rotation'], v: Vec3): Vec3 {
  const [qx, qy, qz, qw] = q
  const [vx, vy, vz] = v

  // t = 2 * cross(q.xyz, v)
  const tx = 2 * (qy * vz - qz * vy)
  const ty = 2 * (qz * vx - qx * vz)
  const tz = 2 * (qx * vy - qy * vx)

  // v + w * t + cross(q.xyz, t)
  return [
    vx + qw * tx + (qy * tz - qz * ty),
    vy + qw * ty + (qz * tx - qx * tz),
    vz + qw * tz + (qx * ty - qy * tx),
  ]
}

/** Converts a point or direction from the engine's Y-up frame to Z-up. */
function yUpToZUp([x, y, z]: Vec3): Vec3 {
  return [x, -z, y]
}

/**
 * Converts a camera saved in `project.toml` into the camera intent a KCL named
 * view stores.
 *
 * The engine camera looks along its local -Z axis with local +Y up, and
 * `pivot_rotation` turns that frame into world space; `setCameraViewAlongZ`
 * relies on the same convention, where the identity rotation is the top view.
 * `eye_offset` is the distance from the pivot to the eye.
 *
 * Field of view and orthographic scale have no KCL equivalent, so a view
 * converted here can frame the model slightly differently from the original.
 */
export function directedCameraFromNamedView(view: NamedView): DirectedCamera {
  const quaternionLength = Math.hypot(...view.pivot_rotation)
  const rotation: NamedView['pivot_rotation'] =
    quaternionLength > 0
      ? [
          view.pivot_rotation[0] / quaternionLength,
          view.pivot_rotation[1] / quaternionLength,
          view.pivot_rotation[2] / quaternionLength,
          view.pivot_rotation[3] / quaternionLength,
        ]
      : [0, 0, 0, 1]

  let direction = rotate(rotation, [0, 0, -1])
  let up = rotate(rotation, [0, 1, 0])
  let target: Vec3 = [...view.pivot_position]

  if (view.world_coord_system === 'right_handed_up_y') {
    direction = yUpToZUp(direction)
    up = yUpToZUp(up)
    target = yUpToZUp(target)
  }

  const distance =
    Number.isFinite(view.eye_offset) && view.eye_offset > 0
      ? view.eye_offset
      : undefined

  return {
    direction,
    up,
    target,
    distance,
    projection: view.is_ortho ? 'orthographic' : 'perspective',
  }
}

/**
 * Turns any display name into one `view::named()` accepts and a KCL string
 * literal holds unchanged.
 *
 * KCL string literals keep backslash escapes as written, so double quotes
 * become single quotes and backslashes become slashes. Surrounding whitespace
 * is trimmed, and an empty result falls back to `fallback`.
 */
export function sanitizeViewName(name: string, fallback: string): string {
  const cleaned = name.replace(/"/g, "'").replace(/\\/g, '/').trim()
  return cleaned.length > 0 ? cleaned : fallback
}

/**
 * Returns `name`, or `name (2)`, `name (3)`, … when it is taken or reserved.
 * Names compare exactly, as `view::named()` compares them.
 */
export function uniqueViewName(
  name: string,
  takenNames: ReadonlySet<string>
): string {
  const isFree = (candidate: string) =>
    candidate !== KCL_DEFAULT_VIEW_NAME && !takenNames.has(candidate)

  if (isFree(name)) {
    return name
  }

  let suffix = 2
  while (!isFree(`${name} (${suffix})`)) {
    suffix++
  }
  return `${name} (${suffix})`
}

function isViewNamedCall(node: { type: string }): node is CallExpressionKw {
  if (node.type !== 'CallExpressionKw') {
    return false
  }
  const { callee } = node as CallExpressionKw
  return (
    callee.name.name === 'named' &&
    callee.path.length === 1 &&
    callee.path[0].name === 'view'
  )
}

/** Returns the names of the views `ast` declares with a literal name. */
export function declaredViewNames(ast: Node<Program>): Set<string> {
  const names = new Set<string>()
  traverse(ast, {
    enter(node) {
      if (!isViewNamedCall(node)) {
        return
      }
      const nameArg = node.unlabeled
      if (nameArg?.type === 'Literal' && typeof nameArg.value === 'string') {
        names.add(nameArg.value)
      }
    },
  })
  return names
}

function viewPath() {
  return [createIdentifier('view')]
}

/** `view::<typeName>::<variant>`, a variant of one of the `std::view` enums. */
function createViewEnumVariant(typeName: string, variant: string) {
  return createLocalName(variant, [
    createIdentifier('view'),
    createIdentifier(typeName),
  ])
}

function createVector(
  vector: Vec3,
  wasmInstance: ModuleType,
  suffix?: NumericSuffix
) {
  return createArrayExpression(
    // `|| 0` turns a rounded -0 into 0.
    vector.map((n) =>
      createLiteral(
        roundOff(n, PRECISION) || 0,
        wasmInstance,
        suffix,
        PRECISION
      )
    )
  )
}

/** `view::directed(...)` for `camera`. */
function createDirectedCameraCall(
  camera: DirectedCamera,
  wasmInstance: ModuleType
): Node<CallExpressionKw> {
  const labeledArgs = [
    createLabeledArg('up', createVector(camera.up, wasmInstance)),
    createLabeledArg('target', createVector(camera.target, wasmInstance, 'Mm')),
  ]
  if (camera.distance !== undefined) {
    labeledArgs.push(
      createLabeledArg(
        'distance',
        createLiteral(
          roundOff(camera.distance, PRECISION),
          wasmInstance,
          'Mm',
          PRECISION
        )
      )
    )
  }
  labeledArgs.push(
    createLabeledArg(
      'projection',
      createViewEnumVariant(
        'Projection',
        camera.projection === 'perspective' ? 'Perspective' : 'Orthographic'
      )
    )
  )

  return createCallExpressionStdLibKw(
    'directed',
    createVector(camera.direction, wasmInstance),
    labeledArgs,
    undefined,
    viewPath()
  )
}

/**
 * `view::named(...)` showing every object through `camera`. `name` must
 * already be valid; see `sanitizeViewName`.
 */
function createNamedViewCall(
  name: string,
  camera: DirectedCamera,
  wasmInstance: ModuleType
): Node<CallExpressionKw> {
  return createCallExpressionStdLibKw(
    'named',
    createLiteral(name, wasmInstance),
    [
      createLabeledArg(
        'camera',
        createDirectedCameraCall(camera, wasmInstance)
      ),
      createLabeledArg('baseline', createViewEnumVariant('Visibility', 'Show')),
    ],
    undefined,
    viewPath()
  )
}

/**
 * Appends one `view::named()` statement per view to the end of `ast`,
 * renaming any view whose name the program already uses.
 *
 * Returns the modified AST, the path to the last added call, and the names
 * the views were written under, in order.
 */
export function addNamedViews({
  ast,
  views,
  wasmInstance,
}: {
  ast: Node<Program>
  views: ReadonlyArray<{ name: string; camera: DirectedCamera }>
  wasmInstance: ModuleType
}):
  | { modifiedAst: Node<Program>; pathToNode: PathToNode; names: string[] }
  | Error {
  if (views.length === 0) {
    return new Error('No named views to add')
  }

  const modifiedAst = structuredClone(ast)
  const taken = declaredViewNames(modifiedAst)
  const names: string[] = []
  let pathToNode: PathToNode = []

  for (const [index, view] of views.entries()) {
    const name = uniqueViewName(
      sanitizeViewName(view.name, `View ${index + 1}`),
      taken
    )
    taken.add(name)
    names.push(name)

    const result = setCallInAst({
      ast: modifiedAst,
      call: createNamedViewCall(name, view.camera, wasmInstance),
      wasmInstance,
    })
    if (err(result)) {
      return result
    }
    pathToNode = result
  }

  return { modifiedAst, pathToNode, names }
}
