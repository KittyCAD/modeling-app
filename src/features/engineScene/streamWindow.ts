import type { ScenePoint } from '@src/contracts/scene'

/**
 * Element pixels to the engine's own pixels.
 *
 * The engine renders at a size it was asked for — clamped into its own bounds and
 * rounded to a multiple of four — which is almost never the size of the panel. So
 * a click at the middle of the element has to arrive as the middle of the
 * *frame*, and the mapping needs both sizes.
 *
 * Shared because there are two callers now: the camera, which drags, and the
 * picker, which asks what is under a point. Getting this wrong in one of them
 * would be a selection that lands slightly off the thing you clicked, which is
 * the kind of bug that reads as flakiness rather than as arithmetic.
 */
export function toStreamWindow(
  at: ScenePoint,
  stream: { width: number; height: number }
): { x: number; y: number } {
  if (at.viewport.width === 0 || at.viewport.height === 0) {
    return { x: 0, y: 0 }
  }

  return {
    x: Math.round((at.x / at.viewport.width) * stream.width),
    y: Math.round((at.y / at.viewport.height) * stream.height),
  }
}
