import type { Artifact } from '@rust/kcl-lib/bindings/Artifact'
import type { ApiObjectId } from '@rust/kcl-lib/bindings/FrontendApi'
import type { ArtifactMap } from '@src/lib/kcl/artifacts'
import { millimetres } from '@src/lib/kcl/units'
import type { PlaneFrame } from '@src/lib/scene/projection'

/**
 * Which plane a sketch is drawn on, and where that plane is.
 *
 * Two coordinate systems have to be brought together before anything can be
 * drawn over the scene: the sketch's own two dimensions, which is all the
 * frontend deals in, and the engine's world, which is where the camera is. The
 * bridge is the plane's frame — an origin and two axes — and this is where it
 * comes from.
 *
 * The artifact graph usually already has it. `sketchBlock` carries a `sketchId`
 * that *is* the frontend's own id for the sketch, so the two models can be
 * matched without a lookup table, and `planeInfo` carries the evaluated frame
 * for a sketch on a plane. A sketch on the face of a solid has neither: where
 * that face ended up is something only the geometry kernel worked out, so it has
 * to be asked for.
 */

/** Where a sketch's plane can be got from. */
export type SketchPlaneSource =
  /** Straight out of the artifact graph. Free, and the common case. */
  | { kind: 'frame'; frame: PlaneFrame }
  /**
   * Only the renderer knows. `entityId` is the face to ask about.
   *
   * A round trip, so it is worth distinguishing from the free answer rather than
   * hiding both behind one async call.
   */
  | { kind: 'face'; entityId: string }
  | { kind: 'unavailable'; reason: string }

/**
 * The frontend's id for the sketch written across a range of the file.
 *
 * The bridge the artifact graph was built to be: a `sketchBlock` artifact
 * carries the frontend's own `sketchId`, so the two models of the file are
 * matched by a link kcl-lib maintains rather than by two range calculations
 * agreeing.
 *
 * That distinction is not academic. Matching on ranges failed, and failed in the
 * least obvious way: our idea of a sketch's extent is the whole
 * `s = sketch(on = XY) { … }` *declaration*, because a cursor on the first line
 * is in the sketch by any useful definition, while the frontend records the
 * range of the `sketch(…)` *expression* — which starts after `s = `. So the
 * offset we were most likely to ask about, the start of the statement, was the
 * one offset guaranteed to fall outside. In a file containing nothing else that
 * is offset 0, and every attempt to open the sketch reported no sketch there.
 *
 * Overlap rather than containment, for the same reason: neither range is
 * reliably inside the other, and asking whether they refer to the same piece of
 * text does not require knowing which is wider. The narrowest match wins, so a
 * nested sketch resolves to the one the cursor is actually in.
 */
export function sketchIdIn(
  artifacts: ArtifactMap,
  range: { from: number; to: number }
): ApiObjectId | null {
  let found: { id: ApiObjectId; width: number } | null = null

  for (const artifact of artifacts.values()) {
    if (artifact.type !== 'sketchBlock') continue

    const [from, to] = artifact.codeRef.range
    // Touching at a boundary counts: an empty block's range can be a point.
    if (to < range.from || from > range.to) continue

    const width = to - from
    if (!found || width < found.width) {
      found = { id: artifact.sketchId, width }
    }
  }

  return found?.id ?? null
}

/** The sketch block the frontend calls `sketchId`. */
export function sketchBlockFor(
  artifacts: ArtifactMap,
  sketchId: ApiObjectId
): Extract<Artifact, { type: 'sketchBlock' }> | null {
  for (const artifact of artifacts.values()) {
    if (artifact.type === 'sketchBlock' && artifact.sketchId === sketchId) {
      return artifact
    }
  }
  return null
}

/**
 * A frame in millimetres, from an artifact's own units.
 *
 * The engine's world is millimetres — kcl-lib converts everything it sends with
 * `to_mm()` — while an artifact reports lengths in whatever the file was written
 * in. The axes are directions and go across unconverted; only the origin is a
 * position.
 */
function frameFrom(
  info: NonNullable<Extract<Artifact, { type: 'sketchBlock' }>['planeInfo']>
): PlaneFrame {
  return {
    origin: {
      x: millimetres(info.origin.x, info.origin.units),
      y: millimetres(info.origin.y, info.origin.units),
      z: millimetres(info.origin.z, info.origin.units),
    },
    xAxis: info.xAxis,
    yAxis: info.yAxis,
    zAxis: info.zAxis,
  }
}

/**
 * Where to get a sketch's plane from.
 *
 * Never throws and never guesses: a sketch whose plane cannot be placed says so
 * with a reason, because "the overlay is blank" and "that sketch is on something
 * we cannot locate yet" are the same thing on screen and completely different
 * things to act on.
 */
export function sketchPlaneSource(
  artifacts: ArtifactMap,
  sketchId: ApiObjectId
): SketchPlaneSource {
  const block = sketchBlockFor(artifacts, sketchId)
  if (!block) {
    return {
      kind: 'unavailable',
      reason: 'The last run does not have that sketch in it.',
    }
  }

  if (block.planeInfo)
    return { kind: 'frame', frame: frameFrom(block.planeInfo) }

  /*
   * A sketch on a face. The plane artifact standing in for the face knows which
   * face it is, and the face's id is the engine's own — so the renderer can be
   * asked where it ended up.
   */
  const plane = block.planeId ? artifacts.get(block.planeId) : undefined
  if (plane?.type === 'planeOfFace') {
    return { kind: 'face', entityId: plane.faceId }
  }
  if (block.planeId && plane?.type === 'plane') {
    /*
     * A plane the run knew about but did not evaluate a frame for. Asking the
     * engine works for these too: it puts sketch mode on whatever entity it is
     * given, and a plane is an entity.
     */
    return { kind: 'face', entityId: block.planeId }
  }

  return {
    kind: 'unavailable',
    reason: 'That sketch is not on anything this app can place yet.',
  }
}
