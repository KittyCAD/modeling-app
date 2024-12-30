import { KclLanguage } from '../src/index'
import { fileTests } from '@lezer/generator/dist/test'

import * as fs from 'fs'
import * as path from 'path'

let caseDir = path.dirname(__filename)

for (let file of fs.readdirSync(caseDir)) {
  if (!/\.txt$/.test(file)) continue

  let fname = /^[^\.]*/.exec(file)[0]
  let tests = fileTests(fs.readFileSync(path.join(caseDir, file), 'utf8'), file)
  describe(fname, () => {
    for (let { name, run } of tests) it(name, () => run(KclLanguage.parser))
  })
}
