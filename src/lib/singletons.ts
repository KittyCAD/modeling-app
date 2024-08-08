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
kclManager.isFirstRender = true

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
  ;(window as any).getEdgesForAndAskEngineForType = async (faceId: string) => {
    // Kurt - Debugging tool used help to show edges aren't stable after further 3d operations
    // if this was added more than a few months ago, it probably can be removed.
    const face = engineCommandManager.artifactGraph.get(faceId)
    if (face?.type !== 'wall') {
      console.log('was expecting a wall, you gave me a ', face?.type)
      return
    }
    const extrusion = engineCommandManager.artifactGraph.get(face.extrusionId)
    if (extrusion?.type !== 'extrusion') {
      console.log('was expecting an extrusion, but got ', extrusion?.type)
      return
    }
    extrusion.edgeIds.forEach(async (edgeId) => {
      const result = await engineCommandManager
        .sendSceneCommand({
          type: 'modeling_cmd_req',
          cmd_id: uuidv4(),
          cmd: {
            type: 'get_entity_type',
            entity_id: edgeId,
          },
        })
        .catch((a) => console.log('error:', a))
      if (!result?.success) return
      if (result.resp.type !== 'modeling') return
      if (result.resp.data.modeling_response.type !== 'get_entity_type') return
      console.log(
        'result edge is: ',
        result.resp.data.modeling_response.data.entity_type,
        ' id: ',
        edgeId
      )
    })
  }
}
