import EngineUtils from './engine-utils/engine.js'

type KCEngineUtilsEvaluatePath = {
  (sketch: string, t: number): string
}
let kcEngineUtilsEvaluatePath: KCEngineUtilsEvaluatePath

export async function init() {
  return await new Promise((resolve, reject) => {
    try {
      EngineUtils().then((module) => {
        kcEngineUtilsEvaluatePath = module.cwrap(
          'kcEngineCalcPathEndpoint',
          'string',
          ['string', 'number']
        )
        resolve(true)
      })
    } catch (e) {
      reject(e)
    }
  })
}

export async function getTruePathEndPos(sketch: string) {
  if (!kcEngineUtilsEvaluatePath) {
    await init()
  }

  return kcEngineUtilsEvaluatePath(sketch, 1.0)
}
