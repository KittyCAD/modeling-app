import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import { reportRejection } from '@src/lib/trap'
import { toSync } from '@src/lib/utils'

/** Forward DOM input through the existing Three.js raycast, drag, and sketch-plane coordinate flow. */
export function attachSketchInput(
  element: HTMLElement,
  infra: Pick<SceneInfra, 'onMouseMove' | 'onMouseDown' | 'onMouseUp'>
) {
  const move = toSync(infra.onMouseMove, reportRejection)
  const up = toSync(infra.onMouseUp, reportRejection)
  element.addEventListener('mousemove', move)
  element.addEventListener('mousedown', infra.onMouseDown)
  element.addEventListener('mouseup', up)
  return () => {
    element.removeEventListener('mousemove', move)
    element.removeEventListener('mousedown', infra.onMouseDown)
    element.removeEventListener('mouseup', up)
  }
}
