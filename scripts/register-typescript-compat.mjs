import { createRequire, registerHooks } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

// TypeScript 7 has no Compiler API yet; openapi-typescript needs ^5.x.
// Reuse the TS 5 package kept for typescript-eslint.
// https://github.com/openapi-ts/openapi-typescript/issues/2841
const require = createRequire(import.meta.url)
const typescriptUrl = pathToFileURL(
  require.resolve('typescript-eslint-typescript')
).href
const typescriptRoot = path.dirname(
  require.resolve('typescript-eslint-typescript/package.json')
)

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'typescript') {
      return { shortCircuit: true, url: typescriptUrl }
    }
    if (specifier.startsWith('typescript/')) {
      return nextResolve(
        pathToFileURL(
          path.join(typescriptRoot, specifier.slice('typescript/'.length))
        ).href,
        context
      )
    }
    return nextResolve(specifier, context)
  },
})
