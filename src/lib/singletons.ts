import { SceneEntities } from 'clientSideScene/sceneEntities'
import { SceneInfra } from 'clientSideScene/sceneInfra'
import { KclManager } from 'lang/KclSingleton'
import { EngineCommandManager } from 'lang/std/engineConnection'

export const engineCommandManager = new EngineCommandManager()

export const kclManager = new KclManager(engineCommandManager)
engineCommandManager.getAstCb = () => kclManager.ast

export const sceneInfra = new SceneInfra(engineCommandManager)
engineCommandManager.camControlsCameraChange = sceneInfra.onCameraChange

export const sceneEntitiesManager = new SceneEntities(engineCommandManager)
