'use strict'

const Module = require('node:module')
const path = require('node:path')

const originalResolveFilename = Module._resolveFilename
const classicTypeScript = require.resolve('typescript-classic')
const classicTypeScriptRoot = path.dirname(
  require.resolve('typescript-classic/package.json')
)

Module._resolveFilename = function resolveTypeScriptClassic(
  request,
  parent,
  isMain,
  options
) {
  if (request === 'typescript') {
    return classicTypeScript
  }

  if (request.startsWith('typescript/')) {
    return originalResolveFilename.call(
      this,
      path.join(classicTypeScriptRoot, request.slice('typescript/'.length)),
      parent,
      isMain,
      options
    )
  }

  return originalResolveFilename.call(this, request, parent, isMain, options)
}
