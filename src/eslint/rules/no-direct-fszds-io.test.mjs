import { RuleTester } from 'eslint'
import { afterAll, describe, it } from 'vitest'
import rule from './no-direct-fszds-io.mjs'

RuleTester.afterAll = afterAll
RuleTester.describe = describe
RuleTester.it = it

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
})

ruleTester.run('no-direct-fszds-io', rule, {
  valid: [
    `import fsZds from '@src/lib/fs-zds'; fsZds.join('project', 'main.kcl')`,
    `import fsZds from '@src/lib/fs-zds'; fsZds.dirname('/project/main.kcl')`,
    `import other from './other'; other.readFile('/project/main.kcl')`,
    `const fsZds = customPathHelpers; fsZds.stat('/project/main.kcl')`,
  ],
  invalid: [
    {
      code: `import fsZds from '@src/lib/fs-zds'; fsZds.readFile('/project/main.kcl')`,
      errors: [{ messageId: 'directFileSystemIo' }],
    },
    {
      code: `import backing from '@src/lib/fs-zds'; backing['writeFile']('/project/main.kcl', bytes)`,
      errors: [{ messageId: 'directFileSystemIo' }],
    },
    {
      code: `import backing from '@src/lib/fs-zds'; backing.rm('/project', { recursive: true })`,
      errors: [{ messageId: 'directFileSystemIo' }],
    },
    {
      code: `import backing from '@src/lib/fs-zds'; backing.access('/project')`,
      errors: [{ messageId: 'directFileSystemIo' }],
    },
  ],
})
