'use strict'

const Module = require('node:module')
const path = require('node:path')

// TypeScript 7 changed the default package/API shape enough that the current
// @typescript-eslint parser cannot load it yet. Keep lint on TS 5 until
// https://github.com/typescript-eslint/typescript-eslint/issues/10940 is fixed.
const originalResolveFilename = Module._resolveFilename
const eslintTypeScript = require.resolve('typescript-eslint-typescript')
const eslintTypeScriptRoot = path.dirname(
  require.resolve('typescript-eslint-typescript/package.json')
)

Module._resolveFilename = function resolveTypeScriptForTypeScriptEslint(
  request,
  parent,
  isMain,
  options
) {
  if (request === 'typescript') {
    return eslintTypeScript
  }

  if (request.startsWith('typescript/')) {
    return originalResolveFilename.call(
      this,
      path.join(eslintTypeScriptRoot, request.slice('typescript/'.length)),
      parent,
      isMain,
      options
    )
  }

  return originalResolveFilename.call(this, request, parent, isMain, options)
}
