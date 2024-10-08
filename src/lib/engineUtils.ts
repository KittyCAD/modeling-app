import * as EngineUtils from './engine-utils/engine.js'

type KCEngineUtilsEvaluatePath = {
  (sketch: string, t: number): string
}
let kcEngineUtilsEvaluatePath: KCEngineUtilsEvaluatePath

export async function init() {
  return await new Promise((resolve, reject) => {
    try {
      kcEngineUtilsEvaluatePath = (s: string, t: number) => {
        return 'it works'
      }
      resolve(true)

      // EngineUtils.Module().then(() => {
      //   kcEngineUtilsEvaluatePath = EngineUtils.Module.cwrap(
      //     'kcEngineCalcPathEndpoint',
      //     'string',
      //     ['string', 'number']
      //   )
      //   resolve(true)
      // })
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
