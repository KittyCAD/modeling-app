import { SceneEntities } from 'clientSideScene/sceneEntities'
import { SceneInfra } from 'clientSideScene/sceneInfra'
import EditorManager from 'editor/manager'
import { KclManager } from 'lang/KclSingleton'
import CodeManager from 'lang/codeManager'
import { EngineCommandManager } from 'lang/std/engineConnection'
import { uuidv4 } from './utils'

export const codeManager = new CodeManager()

export const engineCommandManager = new EngineCommandManager()

// Accessible for tests mostly
// @ts-ignore
window.tearDown = engineCommandManager.tearDown

// This needs to be after codeManager is created.
export const kclManager = new KclManager(engineCommandManager)
engineCommandManager.kclManager = kclManager

engineCommandManager.getAstCb = () => kclManager.ast

export const sceneInfra = new SceneInfra(engineCommandManager)
engineCommandManager.camControlsCameraChange = sceneInfra.onCameraChange

export const sceneEntitiesManager = new SceneEntities(engineCommandManager)

// This needs to be after sceneInfra and engineCommandManager are is created.
export const editorManager = new EditorManager()

if (typeof window !== 'undefined') {
  ;(window as any).engineCommandManager = engineCommandManager
  ;(window as any).kclManager = kclManager
  ;(window as any).sceneInfra = sceneInfra
  ;(window as any).sceneEntitiesManager = sceneEntitiesManager
  ;(window as any).editorManager = editorManager
  ;(window as any).enableMousePositionLogs = () =>
    document.addEventListener('mousemove', (e) =>
      console.log(`await page.mouse.click(${e.clientX}, ${e.clientY})`)
    )
  ;(window as any).enableFillet = () => {
    ;(window as any)._enableFillet = true
  }
  ;(window as any).zoomToFit = () =>
    engineCommandManager.sendSceneCommand({
      type: 'modeling_cmd_req',
      cmd_id: uuidv4(),
      cmd: {
        type: 'zoom_to_fit',
        object_ids: [], // leave empty to zoom to all objects
        padding: 0.2, // padding around the objects
      },
    })
}
