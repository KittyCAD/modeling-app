import { SceneEntities } from 'clientSideScene/sceneEntities'
import { SceneInfra } from 'clientSideScene/sceneInfra'
import { KclManager } from 'lang/KclSingleton'
import CodeManager from 'lang/codeManager'
import Parser from 'lang/parser'
import { EngineCommandManager } from 'lang/std/engineConnection'

export const parser = new Parser()
export const codeManager = new CodeManager()

export const engineCommandManager = new EngineCommandManager()

export const kclManager = new KclManager(engineCommandManager)
engineCommandManager.getAstCb = () => kclManager.ast

export const sceneInfra = new SceneInfra(engineCommandManager)
engineCommandManager.camControlsCameraChange = sceneInfra.onCameraChange

export const sceneEntitiesManager = new SceneEntities(engineCommandManager)
