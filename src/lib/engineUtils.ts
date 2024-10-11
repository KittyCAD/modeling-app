import EngineUtils from '@engine-utils'

type KCEngineUtilsEvaluatePath = {
  (sketch: string, t: number): string
}
let kcEngineUtilsEvaluatePath: KCEngineUtilsEvaluatePath

export async function init() {
  return await new Promise((resolve, reject) => {
    try {
      EngineUtils().then((module) => {
        kcEngineUtilsEvaluatePath = module.cwrap(
          'kcEngineUtilsEvaluatePath',
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
