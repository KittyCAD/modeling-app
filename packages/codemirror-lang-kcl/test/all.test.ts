import { KclLanguage } from '../src/index'
import { fileTests } from '@lezer/generator/dist/test'

import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'

let caseDir = path.dirname(fileURLToPath(import.meta.url))

for (let file of fs.readdirSync(caseDir)) {
  if (!/\.txt$/.test(file)) continue

  let fname = /^[^\.]*/.exec(file)[0]
  let tests = fileTests(fs.readFileSync(path.join(caseDir, file), 'utf8'), file)
  describe(fname, () => {
    for (let { name, run } of tests) it(name, () => run(KclLanguage.parser))
  })
}
