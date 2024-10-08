import * as EngineUtils from './engine-utils/engine.js'

type KCEngineUtilsEvaluatePath = {
  (sketch: string, t: number): string
}
let kcEngineUtilsEvaluatePath: KCEngineUtilsEvaluatePath

export async function init() {
  return await new Promise((resolve) => {
    kcEngineUtilsEvaluatePath = (s: string, t: number) => {
      return 'banana'
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
  })
}

export function getTruePathEndPos(sketch: string) {
  console.log(
    'did this fucking thing get the function ' + kcEngineUtilsEvaluatePath
  )
  return kcEngineUtilsEvaluatePath(sketch, 1.0)
}
