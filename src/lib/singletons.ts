import { SceneEntities } from 'clientSideScene/sceneEntities'
import { SceneInfra } from 'clientSideScene/sceneInfra'
import { KclManager } from 'lang/KclSingleton'
import CodeManager from 'lang/codeManager'
import { EngineCommandManager } from 'lang/std/engineConnection'

export const codeManager = new CodeManager()

export const engineCommandManager = new EngineCommandManager()

export const kclManager = new KclManager(engineCommandManager)
engineCommandManager.getAstCb = () => kclManager.ast

export const sceneInfra = new SceneInfra(engineCommandManager)
engineCommandManager.camControlsCameraChange = sceneInfra.onCameraChange

export const sceneEntitiesManager = new SceneEntities(engineCommandManager)

if (typeof window !== 'undefined') {
  ;(window as any).engineCommandManager = engineCommandManager
  ;(window as any).kclManager = kclManager
  ;(window as any).sceneInfra = sceneInfra
  ;(window as any).sceneEntitiesManager = sceneEntitiesManager
}
