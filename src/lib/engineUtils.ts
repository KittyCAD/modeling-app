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

  //testing
  const obj = {
    path: [
      {
        command: 'moveTo',
        pos: { x: 0, y: 0, z: 0 },
      },
      {
        command: 'lineTo',
        pos: { x: 10, y: 10, z: 0 },
      },
      {
        command: 'bezCurveTo',
        controlPoint1: { x: 15, y: 5, z: 0 },
        controlPoint2: { x: 20, y: 15, z: 0 },
        pos: { x: 25, y: 12.5, z: 0 },
      },
      {
        command: 'tangentialArc',
        radius: 15,
        offset: -45,
      },
    ],
  }
  sketch = JSON.stringify(obj)

  return kcEngineUtilsEvaluatePath(sketch, 1.0)
}
