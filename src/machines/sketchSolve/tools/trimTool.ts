import { setup } from 'xstate'

import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import type RustContext from '@src/lib/rustContext'
import type { KclManager } from '@src/lang/KclManager'
import type { BaseToolEvent } from '@src/machines/sketchSolve/tools/sharedToolTypes'
import type {
  ExistingSegmentCtor,
  SceneGraphDelta,
  SourceDelta,
} from '@rust/kcl-lib/bindings/FrontendApi'
import { jsAppSettings } from '@src/lib/settings/settingsUtils'
import { roundOff } from '@src/lib/utils'
import { distance2d } from '@src/lib/utils2d'
import { BufferGeometry, Line, LineBasicMaterial, Vector3 } from 'three'

// Trim tool draws an ephemeral polyline during an area-select drag.
// At drag end the preview is removed – no sketch entities are created (yet).

const TOOL_ID = 'Trim tool'

// Pure function that processes trim operations on a polyline
// Returns the final scene graph delta and source delta
export async function processTrimOperations({
  points,
  initialSceneGraph,
  rustContext,
  sketchId,
  lastPointIndex = 0,
}: {
  points: Vector3[]
  initialSceneGraph: SceneGraphDelta
  rustContext: RustContext
  sketchId: number
  lastPointIndex?: number
}): Promise<{
  kclSource: SourceDelta
  sceneGraphDelta: SceneGraphDelta
  invalidates_ids: boolean
} | null> {
  let currentSceneGraph = initialSceneGraph
  let invalidates_ids = false
  let lastDeleteResult: {
    kclSource: SourceDelta
    sceneGraphDelta: SceneGraphDelta
  } | null = null

  // Loop until we've processed all polyline segments
  while (
    currentSceneGraph &&
    points.length >= 2 &&
    lastPointIndex < points.length - 1
  ) {
    const objects = currentSceneGraph.new_graph.objects

    // Find first intersection starting from lastPointIndex
    const foundIntersection = findFirstIntersectionWithPolylineSegment(
      points,
      objects,
      lastPointIndex
    )

    if (!foundIntersection) {
      // No more intersections found, we're done
      break
    }

    // Second pass: Find all segments that intersect with the intersected segment
    const segmentIntersections = findSegmentsThatIntersect(
      foundIntersection.segmentId,
      objects
    )

    const trimSides = findTwoClosestPointsToIntersection(
      foundIntersection.location,
      foundIntersection.segmentId,
      segmentIntersections,
      objects
    )

    // Early continue if trimSides is an error
    if (trimSides instanceof Error) {
      lastPointIndex = foundIntersection.pointIndex + 1
      continue
    }

    // Only delete if segment has no intersections with other segments
    if (
      trimSides.startSide.type === 'endpoint' &&
      trimSides.endSide.type === 'endpoint'
    ) {
      try {
        const result = await rustContext.deleteObjects(
          0,
          sketchId,
          [], // constraintIds - empty, we're only deleting the segment
          [foundIntersection.segmentId], // segmentIds
          await jsAppSettings()
        )

        invalidates_ids =
          result.sceneGraphDelta.invalidates_ids || invalidates_ids
        lastDeleteResult = result
        currentSceneGraph = result.sceneGraphDelta
        // Update lastPointIndex to continue from after this intersection
        lastPointIndex = foundIntersection.pointIndex + 1
      } catch (error) {
        console.error('Failed to delete segment:', error)
        // Stop on error
        break
      }
      continue
    }

    // Handle endpoint-to-intersection case (move endpoint to intersection)
    if (
      (trimSides.startSide.type === 'endpoint' &&
        trimSides.endSide.type === 'intersection') ||
      (trimSides.endSide.type === 'endpoint' &&
        trimSides.startSide.type === 'intersection')
    ) {
      const segment = objects[foundIntersection.segmentId]
      if (
        segment.kind.type !== 'Segment' ||
        segment.kind.segment.type !== 'Line'
      ) {
        lastPointIndex = foundIntersection.pointIndex + 1
        continue
      }

      const endPointId =
        trimSides.startSide.type === 'endpoint'
          ? segment.kind.segment.start
          : segment.kind.segment.end
      const intersectionLocation =
        trimSides.startSide.type === 'endpoint'
          ? trimSides.endSide.point
          : trimSides.startSide.point

      const endPoint = objects[endPointId]
      if (
        endPoint.kind.type !== 'Segment' ||
        endPoint.kind.segment.type !== 'Point'
      ) {
        lastPointIndex = foundIntersection.pointIndex + 1
        continue
      }

      // Get the current point's position to extract units
      const units = endPoint.kind.segment.position.x.units

      // Update the point position
      try {
        const result = await rustContext.editSegments(
          0,
          sketchId,
          [
            {
              id: endPointId,
              ctor: {
                type: 'Point',
                position: {
                  x: {
                    type: 'Var',
                    value: intersectionLocation[0],
                    units,
                  },
                  y: {
                    type: 'Var',
                    value: intersectionLocation[1],
                    units,
                  },
                },
              },
            },
          ],
          await jsAppSettings()
        )

        invalidates_ids =
          result.sceneGraphDelta.invalidates_ids || invalidates_ids

        // Default to using the edit result
        lastDeleteResult = result
        currentSceneGraph = result.sceneGraphDelta

        // If the intersection is coincident, try to add a coincident constraint
        const intersectionSide =
          trimSides.startSide.type === 'endpoint'
            ? trimSides.endSide
            : trimSides.startSide

        if (
          intersectionSide.type === 'intersection' &&
          intersectionSide.subType === 'coincident'
        ) {
          const otherSegment = objects[intersectionSide.segmentId]
          if (
            otherSegment?.kind?.type === 'Segment' &&
            otherSegment.kind.segment.type === 'Line'
          ) {
            const otherStart = getPointCoords(
              otherSegment.kind.segment.start,
              objects
            )
            const otherEnd = getPointCoords(
              otherSegment.kind.segment.end,
              objects
            )

            // Find which endpoint of the other segment is at the intersection location
            let otherPointId: number | null = null
            if (
              otherStart &&
              distance2d(otherStart, intersectionSide.point) <
                EPSILON_POINT_ON_SEGMENT
            ) {
              otherPointId = otherSegment.kind.segment.start
            } else if (
              otherEnd &&
              distance2d(otherEnd, intersectionSide.point) <
                EPSILON_POINT_ON_SEGMENT
            ) {
              otherPointId = otherSegment.kind.segment.end
            }

            if (otherPointId !== null) {
              try {
                const constraintResult = await rustContext.addConstraint(
                  0,
                  sketchId,
                  {
                    type: 'Coincident',
                    points: [endPointId, otherPointId],
                  },
                  await jsAppSettings()
                )

                invalidates_ids =
                  constraintResult.sceneGraphDelta.invalidates_ids ||
                  invalidates_ids

                // Use the constraint result as it contains the final scene graph state
                lastDeleteResult = constraintResult
                currentSceneGraph = constraintResult.sceneGraphDelta
              } catch (error) {
                console.error('Failed to add coincident constraint:', error)
                // Continue even if constraint fails - the point was already moved
              }
            }
          }
        }
      } catch (error) {
        console.error('Failed to update point position:', error)
        // Stop on error
        break
      }
      continue
    }

    // Handle intersection-to-intersection case (split segment)
    if (
      trimSides.startSide.type === 'intersection' &&
      trimSides.endSide.type === 'intersection'
    ) {
      const startIntersection = trimSides.startSide.point
      const endIntersection = trimSides.endSide.point
      const segment = objects[foundIntersection.segmentId]

      if (
        segment?.kind?.type !== 'Segment' ||
        segment.kind.segment.type !== 'Line'
      ) {
        lastPointIndex = foundIntersection.pointIndex + 1
        continue
      }

      const originalStartPoint = getPointCoords(
        segment.kind.segment.start,
        objects
      )
      const originalEndPoint = getPointCoords(segment.kind.segment.end, objects)

      if (!originalStartPoint || !originalEndPoint) {
        console.error('Could not get original line endpoints')
        lastPointIndex = foundIntersection.pointIndex + 1
        continue
      }

      // Get units from the original line's end point
      const endPointObj = objects[segment.kind.segment.end]
      if (
        endPointObj?.kind?.type !== 'Segment' ||
        endPointObj.kind.segment.type !== 'Point'
      ) {
        console.error('Could not get end point object for units')
        lastPointIndex = foundIntersection.pointIndex + 1
        continue
      }

      const units = endPointObj.kind.segment.position.x.units

      try {
        // Step 1: Edit the existing line to end at startIntersection
        const editResult = await rustContext.editSegments(
          0,
          sketchId,
          [
            {
              id: foundIntersection.segmentId,
              ctor: {
                type: 'Line',
                start: {
                  x: {
                    type: 'Var',
                    value: originalStartPoint[0],
                    units,
                  },
                  y: {
                    type: 'Var',
                    value: originalStartPoint[1],
                    units,
                  },
                },
                end: {
                  x: {
                    type: 'Var',
                    value: startIntersection[0],
                    units,
                  },
                  y: {
                    type: 'Var',
                    value: startIntersection[1],
                    units,
                  },
                },
              },
            },
          ],
          await jsAppSettings()
        )

        invalidates_ids =
          editResult.sceneGraphDelta.invalidates_ids || invalidates_ids

        // Update scene graph after edit (needed for consistency, even though addSegment uses internal state)
        currentSceneGraph = editResult.sceneGraphDelta

        // Step 2: Create a new line segment from endIntersection to the original end point
        const addResult = await rustContext.addSegment(
          0,
          sketchId,
          {
            type: 'Line',
            start: {
              x: {
                type: 'Var',
                value: endIntersection[0],
                units,
              },
              y: {
                type: 'Var',
                value: endIntersection[1],
                units,
              },
            },
            end: {
              x: {
                type: 'Var',
                value: originalEndPoint[0],
                units,
              },
              y: {
                type: 'Var',
                value: originalEndPoint[1],
                units,
              },
            },
          },
          undefined, // label
          await jsAppSettings()
        )

        invalidates_ids =
          addResult.sceneGraphDelta.invalidates_ids || invalidates_ids

        // Use the addResult as it contains the final scene graph state
        lastDeleteResult = addResult
        currentSceneGraph = addResult.sceneGraphDelta
        lastPointIndex = foundIntersection.pointIndex + 1
      } catch (error) {
        console.error('Failed to split line segment:', error)
        // Stop on error
        break
      }
      continue
    }

    // Default case: Segment has intersections with other segments, can't delete
    // Move past this intersection point
    lastPointIndex = foundIntersection.pointIndex + 1
  }

  // Round all point coordinates before returning
  if (lastDeleteResult) {
    const objects = lastDeleteResult.sceneGraphDelta.new_graph.objects
    const pointSegmentsToRound: ExistingSegmentCtor[] = []

    // Collect all Point segments and round their coordinates
    for (let i = 0; i < objects.length; i++) {
      const obj = objects[i]
      if (obj?.kind?.type === 'Segment' && obj.kind.segment.type === 'Point') {
        const position = obj.kind.segment.position
        const roundedX = roundOff(position.x.value)
        const roundedY = roundOff(position.y.value)

        // Only add if rounding changed the values
        if (roundedX !== position.x.value || roundedY !== position.y.value) {
          pointSegmentsToRound.push({
            id: i,
            ctor: {
              type: 'Point',
              position: {
                x: {
                  type: 'Var',
                  value: roundedX,
                  units: position.x.units,
                },
                y: {
                  type: 'Var',
                  value: roundedY,
                  units: position.y.units,
                },
              },
            },
          })
        }
      }
    }

    // Apply rounding to all points if any need rounding
    let finalResult = lastDeleteResult
    if (pointSegmentsToRound.length > 0) {
      try {
        const roundingResult = await rustContext.editSegments(
          0,
          sketchId,
          pointSegmentsToRound,
          await jsAppSettings()
        )
        invalidates_ids =
          roundingResult.sceneGraphDelta.invalidates_ids || invalidates_ids
        finalResult = {
          kclSource: roundingResult.kclSource,
          sceneGraphDelta: roundingResult.sceneGraphDelta,
        }
      } catch (error) {
        console.error('Failed to round point coordinates:', error)
        // Continue with unrounded result if rounding fails
      }
    }

    const result = {
      kclSource: finalResult.kclSource,
      sceneGraphDelta: {
        ...finalResult.sceneGraphDelta,
        invalidates_ids,
      },
      invalidates_ids,
    }
    return result
  }
  return null
}

// Epsilon constants for geometric calculations
const EPSILON_PARALLEL = 1e-10 // For checking if lines are parallel or segments are degenerate
const EPSILON_POINT_ON_SEGMENT = 1e-6 // For checking if a point is on a segment

// Helper to project a point onto a line segment and get its parametric position
// Returns t where t=0 at start, t=1 at end, t<0 before start, t>1 after end
function projectPointOntoSegment(
  point: [number, number],
  segmentStart: [number, number],
  segmentEnd: [number, number]
): number {
  const dx = segmentEnd[0] - segmentStart[0]
  const dy = segmentEnd[1] - segmentStart[1]
  const segmentLengthSq = dx * dx + dy * dy

  if (segmentLengthSq < EPSILON_PARALLEL) {
    // Segment is degenerate (start and end are the same)
    return 0
  }

  const pointDx = point[0] - segmentStart[0]
  const pointDy = point[1] - segmentStart[1]
  const t = (pointDx * dx + pointDy * dy) / segmentLengthSq

  return t
}

// Helper to check if a point is on a line segment (within epsilon distance)
// Returns the point if it's on the segment, null otherwise
function isPointOnSegment(
  point: [number, number],
  segmentStart: [number, number],
  segmentEnd: [number, number],
  epsilon = EPSILON_POINT_ON_SEGMENT
): [number, number] | null {
  const t = projectPointOntoSegment(point, segmentStart, segmentEnd)

  // Check if point projects onto the segment (t between 0 and 1)
  if (t < 0 || t > 1) {
    return null
  }

  // Calculate the projected point on the segment
  const projectedPoint: [number, number] = [
    segmentStart[0] + t * (segmentEnd[0] - segmentStart[0]),
    segmentStart[1] + t * (segmentEnd[1] - segmentStart[1]),
  ]

  // Check if the distance from point to projected point is within epsilon
  const dx = point[0] - projectedPoint[0]
  const dy = point[1] - projectedPoint[1]
  const distanceSq = dx * dx + dy * dy

  if (distanceSq <= epsilon * epsilon) {
    return point // Return the actual point, not the projected one
  }

  return null
}

// Helper to calculate intersection point of two line segments
// Also checks if endpoints are on the other segment (within epsilon)
// Returns null if they don't intersect, or an object with the intersection point and whether it's coincident
function lineSegmentIntersection(
  p1: [number, number],
  p2: [number, number],
  p3: [number, number],
  p4: [number, number],
  epsilon = EPSILON_POINT_ON_SEGMENT
): { point: [number, number]; isCoincident: boolean } | null {
  // First check if any endpoints are on the other segment (coincident case)
  const p1OnSegment2 = isPointOnSegment(p1, p3, p4, epsilon)
  if (p1OnSegment2) return { point: p1OnSegment2, isCoincident: true }

  const p2OnSegment2 = isPointOnSegment(p2, p3, p4, epsilon)
  if (p2OnSegment2) return { point: p2OnSegment2, isCoincident: true }

  const p3OnSegment1 = isPointOnSegment(p3, p1, p2, epsilon)
  if (p3OnSegment1) return { point: p3OnSegment1, isCoincident: true }

  const p4OnSegment1 = isPointOnSegment(p4, p1, p2, epsilon)
  if (p4OnSegment1) return { point: p4OnSegment1, isCoincident: true }

  // Then check for actual line segment intersection (true intersection)
  const [x1, y1] = p1
  const [x2, y2] = p2
  const [x3, y3] = p3
  const [x4, y4] = p4

  const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4)
  if (Math.abs(denom) < EPSILON_PARALLEL) {
    // Lines are parallel
    return null
  }

  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom
  const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denom

  // Check if intersection is within both segments
  if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
    const x = x1 + t * (x2 - x1)
    const y = y1 + t * (y2 - y1)
    return { point: [x, y], isCoincident: false }
  }

  return null
}

// Helper to get point coordinates from sceneGraph
function getPointCoords(
  pointId: number,
  objects: Array<any>
): [number, number] | null {
  const point = objects[pointId]
  if (
    point?.kind?.type !== 'Segment' ||
    point?.kind?.segment?.type !== 'Point'
  ) {
    return null
  }
  return [
    point.kind.segment.position.x.value,
    point.kind.segment.position.y.value,
  ]
}

// Pure function: Finds the first intersection between the polyline and any scene segment
// Loops over polyline segments and checks each against all scene segments
// Returns null if no intersection is found
export function findFirstIntersectionWithPolylineSegment(
  points: Vector3[],
  objects: SceneGraphDelta['new_graph']['objects'],
  startIndex = 0
): {
  location: [number, number]
  segmentId: number
  pointIndex: number
} | null {
  // Loop over polyline segments
  for (let i = startIndex; i < points.length - 1; i++) {
    const p1: [number, number] = [points[i].x, points[i].y]
    const p2: [number, number] = [points[i + 1].x, points[i + 1].y]

    // Check this polyline segment against all scene segments
    for (let segmentId = 0; segmentId < objects.length; segmentId++) {
      const obj = objects[segmentId]
      if (obj?.kind?.type !== 'Segment' || obj.kind.segment.type !== 'Line') {
        continue
      }

      const startPoint = getPointCoords(obj.kind.segment.start, objects)
      const endPoint = getPointCoords(obj.kind.segment.end, objects)

      if (!startPoint || !endPoint) {
        continue
      }

      const intersection = lineSegmentIntersection(p1, p2, startPoint, endPoint)

      if (intersection) {
        return {
          location: intersection.point,
          segmentId,
          pointIndex: i,
        }
      }
    }
  }

  return null
}

// Pure function: Finds all segments that intersect with a given segment
export function findSegmentsThatIntersect(
  segmentId: number,
  objects: SceneGraphDelta['new_graph']['objects']
): Array<{
  location: [number, number]
  segmentId: number
  subType: 'trueIntersect' | 'coincident'
}> {
  const intersectedObj = objects[segmentId]

  if (
    intersectedObj?.kind?.type !== 'Segment' ||
    intersectedObj.kind.segment.type !== 'Line'
  ) {
    return []
  }

  const intersectedStart = getPointCoords(
    intersectedObj.kind.segment.start,
    objects
  )
  const intersectedEnd = getPointCoords(
    intersectedObj.kind.segment.end,
    objects
  )

  if (!intersectedStart || !intersectedEnd) {
    return []
  }

  const segmentIntersections: Array<{
    location: [number, number]
    segmentId: number
    subType: 'trueIntersect' | 'coincident'
  }> = []

  // Check this segment against all other segments
  for (
    let otherSegmentId = 0;
    otherSegmentId < objects.length;
    otherSegmentId++
  ) {
    // Skip itself
    if (otherSegmentId === segmentId) continue

    const otherObj = objects[otherSegmentId]
    if (
      otherObj?.kind?.type === 'Segment' &&
      otherObj.kind.segment.type === 'Line'
    ) {
      const otherStart = getPointCoords(otherObj.kind.segment.start, objects)
      const otherEnd = getPointCoords(otherObj.kind.segment.end, objects)

      if (otherStart && otherEnd) {
        const segmentIntersection = lineSegmentIntersection(
          intersectedStart,
          intersectedEnd,
          otherStart,
          otherEnd
        )

        if (segmentIntersection) {
          segmentIntersections.push({
            location: segmentIntersection.point,
            segmentId: otherSegmentId,
            subType: segmentIntersection.isCoincident
              ? 'coincident'
              : 'trueIntersect',
          })
        }
      }
    }
  }

  return segmentIntersections
}

type IntersectionOrEndPoint =
  | {
      point: [number, number]
      type: 'endpoint'
    }
  | {
      point: [number, number]
      type: 'intersection'
      segmentId: number
      subType: 'trueIntersect' | 'coincident'
    }

interface SegmentTrimSides {
  startSide: IntersectionOrEndPoint
  endSide: IntersectionOrEndPoint
}

// Pure function: Finds the first point encountered in each direction along the segment
// from the intersection point where the drawn line intersects the segment
// Returns the two sides of the segment (startSide and endSide) or an Error
export function findTwoClosestPointsToIntersection(
  intersectionPoint: [number, number],
  segmentId: number,
  segmentIntersections: Array<{
    location: [number, number]
    segmentId: number
    subType: 'trueIntersect' | 'coincident'
  }>,
  objects: SceneGraphDelta['new_graph']['objects']
): SegmentTrimSides | Error {
  const segmentObj = objects[segmentId]
  if (
    segmentObj?.kind?.type !== 'Segment' ||
    segmentObj.kind.segment.type !== 'Line'
  ) {
    return new Error('Segment is not a line segment')
  }

  const startPoint = getPointCoords(segmentObj.kind.segment.start, objects)
  const endPoint = getPointCoords(segmentObj.kind.segment.end, objects)

  if (!startPoint || !endPoint) {
    return new Error('Could not get segment endpoint coordinates')
  }

  // Project the intersection point onto the segment to get its parametric position
  const intersectionT = projectPointOntoSegment(
    intersectionPoint,
    startPoint,
    endPoint
  )

  // Collect all candidate points: endpoints and intersections
  // Exclude points that are too close to the intersection point itself
  const allCandidates: Array<
    | {
        point: [number, number]
        type: 'endpoint'
        which: 'start' | 'end'
        t: number
      }
    | {
        point: [number, number]
        type: 'intersection'
        segmentId: number
        subType: 'trueIntersect' | 'coincident'
        t: number
      }
  > = [
    {
      point: startPoint,
      type: 'endpoint' as const,
      which: 'start' as const,
      t: 0,
    },
    { point: endPoint, type: 'endpoint' as const, which: 'end' as const, t: 1 },
    ...segmentIntersections.map((si) => ({
      point: si.location,
      type: 'intersection' as const,
      segmentId: si.segmentId,
      subType: si.subType,
      t: projectPointOntoSegment(si.location, startPoint, endPoint),
    })),
  ]
  const candidatePoints = allCandidates.filter(
    (cp) => Math.abs(cp.t - intersectionT) > EPSILON_POINT_ON_SEGMENT
  ) // Exclude the intersection point itself

  // Find the first point encountered when traveling towards the start (t < intersectionT)
  // Prioritize intersections over endpoints when both exist
  const pointsBefore = candidatePoints
    .filter((cp) => cp.t < intersectionT - EPSILON_POINT_ON_SEGMENT)
    .sort((a, b) => {
      // First sort by type: intersections come before endpoints
      if (a.type !== b.type) {
        return a.type === 'intersection' ? -1 : 1
      }
      // Then by distance from intersection (descending - closest first)
      return b.t - a.t
    })
  const pointBefore = pointsBefore[0]

  // Find the first point encountered when traveling towards the end (t > intersectionT)
  // Prioritize intersections over endpoints when both exist
  const pointsAfter = candidatePoints
    .filter((cp) => cp.t > intersectionT + EPSILON_POINT_ON_SEGMENT)
    .sort((a, b) => {
      // First sort by type: intersections come before endpoints
      if (a.type !== b.type) {
        return a.type === 'intersection' ? -1 : 1
      }
      // Then by distance from intersection (ascending - closest first)
      return a.t - b.t
    })
  const pointAfter = pointsAfter[0]

  // Validate that we have points on both sides
  if (!pointBefore || !pointAfter) {
    return new Error(
      'Could not find points on both sides of the intersection point'
    )
  }

  // Build the startSide (point before intersection, traveling towards start)
  const startSide: IntersectionOrEndPoint =
    pointBefore.type === 'endpoint'
      ? {
          point: pointBefore.point,
          type: 'endpoint',
        }
      : {
          point: pointBefore.point,
          type: 'intersection',
          segmentId: pointBefore.segmentId,
          subType: pointBefore.subType,
        }

  // Build the endSide (point after intersection, traveling towards end)
  const endSide: IntersectionOrEndPoint =
    pointAfter.type === 'endpoint'
      ? {
          point: pointAfter.point,
          type: 'endpoint',
        }
      : {
          point: pointAfter.point,
          type: 'intersection',
          segmentId: pointAfter.segmentId,
          subType: pointAfter.subType,
        }

  return {
    startSide,
    endSide,
  }
}

type ToolEvents = BaseToolEvent

export const machine = setup({
  types: {
    context: {} as {
      sceneInfra: SceneInfra
      rustContext: RustContext
      kclManager: KclManager
      sketchId: number
      sceneGraphDelta?: SceneGraphDelta
    },
    events: {} as ToolEvents,
    input: {} as {
      sceneInfra: SceneInfra
      rustContext: RustContext
      kclManager: KclManager
      sketchId: number
      sceneGraphDelta?: SceneGraphDelta
    },
  },
  actions: {
    'add area select listener': ({ context, self }) => {
      const scene = context.sceneInfra.scene
      let currentLine: Line | null = null
      let points: Vector3[] = []
      let lastPoint2D: [number, number] | null = null
      let lastPointIndex = 0

      const pxThreshold = 5

      // Helper to get pixel distance between two world-space points
      const distancePx = (a: [number, number], b: [number, number]) =>
        context.sceneInfra.screenSpaceDistance(a, b)

      context.sceneInfra.setCallbacks({
        onAreaSelectStart: ({ startPoint }) => {
          if (!startPoint?.twoD) return
          // Store the starting point but don't create the Line yet (needs at least 2 points)
          points = [
            new Vector3(startPoint.twoD.x, startPoint.twoD.y, 0),
          ] as Vector3[]
          lastPoint2D = [startPoint.twoD.x, startPoint.twoD.y]
          lastPointIndex = 0 // Reset for new drag
        },
        onAreaSelect: ({ currentPoint }) => {
          if (!currentPoint?.twoD || !lastPoint2D) return
          const { x, y } = currentPoint.twoD
          const distance = distancePx(lastPoint2D, [x, y])
          if (distance >= pxThreshold) {
            points.push(new Vector3(x, y, 0))

            // Create the Line when we have at least 2 points
            if (!currentLine && points.length >= 2) {
              const geom = new BufferGeometry().setFromPoints(points)
              const mat = new LineBasicMaterial({ color: 0xff8800 })
              currentLine = new Line(geom, mat)
              currentLine.name = 'trim-tool-preview'
              scene.add(currentLine)
            } else if (currentLine) {
              // Update existing line: dispose old geometry and create new one
              // (setFromPoints doesn't resize buffers, so we need a fresh geometry)
              const oldGeom = currentLine.geometry
              const newGeom = new BufferGeometry().setFromPoints(points)
              currentLine.geometry = newGeom
              oldGeom.dispose()
            }

            lastPoint2D = [x, y]
          }
        },
        onAreaSelectEnd: async () => {
          if (!context.sceneGraphDelta) {
            return
          }

          const initialSceneGraph = context.sceneGraphDelta
          const result = await processTrimOperations({
            points,
            initialSceneGraph,
            rustContext: context.rustContext,
            sketchId: context.sketchId,
            lastPointIndex,
          })

          if (result) {
            // Send the final result to parent to update sketch outcome
            self._parent?.send({
              type: 'update sketch outcome',
              data: {
                kclSource: result.kclSource,
                sceneGraphDelta: result.sceneGraphDelta,
              },
            })
          }

          if (currentLine) {
            scene.remove(currentLine)
            currentLine.geometry.dispose()
            ;(currentLine.material as LineBasicMaterial).dispose()
            currentLine = null
            points = []
            lastPoint2D = null
          }
        },
      })
    },
    'remove area select listener': ({ context }) => {
      context.sceneInfra.setCallbacks({
        onAreaSelectStart: () => {},
        onAreaSelect: () => {},
        onAreaSelectEnd: () => {},
      })
    },
  },
}).createMachine({
  context: ({ input }) => ({
    sceneInfra: input.sceneInfra,
    rustContext: input.rustContext,
    kclManager: input.kclManager,
    sketchId: input.sketchId,
    sceneGraphDelta: input.sceneGraphDelta,
  }),
  id: TOOL_ID,
  initial: 'active',
  on: {
    unequip: {
      target: '#Trim tool.unequipping',
    },
    escape: {
      target: '#Trim tool.unequipping',
    },
  },
  states: {
    active: {
      entry: 'add area select listener',
    },
    unequipping: {
      type: 'final',
      entry: 'remove area select listener',
    },
  },
})
