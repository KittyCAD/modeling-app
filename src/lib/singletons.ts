import EditorManager from '@src/editor/manager'
import { KclManager } from '@src/lang/KclSingleton'
import CodeManager from '@src/lang/codeManager'
import { EngineCommandManager } from '@src/lang/std/engineConnection'
import RustContext from '@src/lib/rustContext'
import { uuidv4 } from '@src/lib/utils'

import { SceneEntities } from '@src/clientSideScene/sceneEntities'
import { SceneInfra } from '@src/clientSideScene/sceneInfra'

export const codeManager = new CodeManager()

export const engineCommandManager = new EngineCommandManager()

declare global {
  interface Window {
    editorManager: EditorManager
    engineCommandManager: EngineCommandManager
  }
}

// Accessible for tests mostly
window.engineCommandManager = engineCommandManager

// This needs to be after codeManager is created.
export const kclManager = new KclManager(engineCommandManager)
engineCommandManager.kclManager = kclManager

export const sceneInfra = new SceneInfra(engineCommandManager)
engineCommandManager.camControlsCameraChange = sceneInfra.onCameraChange

// This needs to be after sceneInfra and engineCommandManager are is created.
export const editorManager = new EditorManager()

export const rustContext = new RustContext(engineCommandManager)

export const sceneEntitiesManager = new SceneEntities(
  engineCommandManager,
  sceneInfra,
  editorManager,
  codeManager,
  kclManager,
  rustContext
)

if (typeof window !== 'undefined') {
  ;(window as any).engineCommandManager = engineCommandManager
  ;(window as any).kclManager = kclManager
  ;(window as any).sceneInfra = sceneInfra
  ;(window as any).sceneEntitiesManager = sceneEntitiesManager
  ;(window as any).editorManager = editorManager
  ;(window as any).codeManager = codeManager
  ;(window as any).rustContext = rustContext
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
        animated: false, // don't animate the zoom for now
      },
    })
}
