import { stringToKclExpression } from '@src/lib/kclHelpers'
import { err } from '@src/lib/trap'
import env from '@src/env'
import { engineCommandManager } from '@src/lib/singletons'

export async function getKclCommandValue(value: string) {
  const result = await stringToKclExpression(value)
  if (err(result) || 'errors' in result) {
    throw new Error(`Couldn't create kcl expression`)
  }

  return result
}

export const engineCommandManagerStartPromise = new Promise((resolve) => {
  engineCommandManager.start({
    token: env().VITE_KITTYCAD_API_TOKEN,
    width: 256,
    height: 256,
    setMediaStream: () => {},
    setIsStreamReady: () => {},
    callbackOnEngineLiteConnect: () => {
      resolve(true)
    },
  })
})
