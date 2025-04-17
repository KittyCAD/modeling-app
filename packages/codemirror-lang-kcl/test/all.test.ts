import * as fs from 'fs'
import * as path from 'path'
import { fileTests } from '@lezer/generator/dist/test'

import { KclLanguage } from '../src/index'

let caseDir = path.dirname(__filename)

for (let file of fs.readdirSync(caseDir)) {
  if (!/\.txt$/.test(file)) continue

  let fname = /^[^\.]*/.exec(file)?.at(0)
  if (fname) {
    let tests = fileTests(
      fs.readFileSync(path.join(caseDir, file), 'utf8'),
      file
    )
    describe(fname, () => {
      for (let { name, run } of tests) it(name, () => run(KclLanguage.parser))
    })
  }
}
