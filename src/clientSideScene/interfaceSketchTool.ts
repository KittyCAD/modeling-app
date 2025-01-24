import { SceneInfra } from './sceneInfra'

export interface SketchTool {
  init: () => void

  // Update could mean draw, refresh editor state, etc. It's up to the
  // SketchTool implementer.
  update: () => void

  // Clean up the state (such as ThreeJS scene)
  destroy: () => void

  // To be hooked into sceneInfra.callbacks or other places as necessary.
  // All the necessary types exist in SceneInfra. If it ever majorly changes
  // we want this to break such that they are corrected too.
  onDragStart?: (typeof SceneInfra)['onDragStartCallback']
  onDragEnd?: (typeof SceneInfra)['onDragEndCallback']
  onDrag?: (typeof SceneInfra)['onDragCallback']
  onMove?: (typeof SceneInfra)['onMoveCallback']
  onClick?: (typeof SceneInfra)['onClickCallback']
  onMouseEnter?: (typeof SceneInfra)['onMouseEnterCallback']
  onMouseLeave?: (typeof SceneInfra)['onMouseLeaveCallback']
}

export function NoOpTool(): SketchTool {
  this.init = () => {}
  this.update = () => {}
  this.destroy = () => {}
  return this
}
