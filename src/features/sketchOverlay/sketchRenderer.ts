/**
 * Everything about the sketch that needs THREE, behind one import.
 *
 * One module rather than two so the whole renderer is a single dynamic import:
 * THREE is most of a megabyte and nobody should be waiting for it before the app
 * paints. The gizmo does the same, and because both reach it this way they share
 * one chunk — so opening a sketch after the gizmo has drawn costs nothing at all.
 */
export { Group } from 'three'
export {
  type SketchScene,
  createSketchScene,
} from '@src/features/sketchOverlay/createSketchScene'
export {
  type SegmentAppearance,
  drawSketch,
} from '@src/features/sketchOverlay/sketchSegments'
