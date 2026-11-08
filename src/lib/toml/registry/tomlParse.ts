import { defineExecutorCapability } from '@src/lib/executors/registry/contract'
import { readToml } from '@src/lib/toml/document'
import { isErr } from '@src/lib/trap'

// Use Symbols so that any other TOML executor outputs never collide
export const tomlParseOutputKey = Symbol('toml parse executor output key')

export const tomlParse = defineExecutorCapability({
  id: 'toml.parse',
  matches: '.toml',
  execute: (contents) => {
    const table = readToml(contents)
    return isErr(table) ? table : { [tomlParseOutputKey]: table }
  },
})
