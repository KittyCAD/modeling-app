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
    `import fsZds from '@src/lib/fs-zds/index'; fsZds.dirname('/project/main.kcl')`,
    `import { default as paths } from '@src/lib/fs-zds/index.ts'; paths['resolve']('/project/main.kcl')`,
    `import other from './other'; other.readFile('/project/main.kcl')`,
    `const fsZds = customPathHelpers; fsZds.stat('/project/main.kcl')`,
    `import fsZds from '@src/lib/fs-zds'; function inspect(fsZds) { fsZds.readFile('/project/main.kcl') }`,
    `import fsZds from '@src/lib/fs-zds'; { const fsZds = customFileSystem; fsZds.writeFile('/project/main.kcl', bytes) }`,
  ],
  invalid: [
    {
      code: `import fsZds from '@src/lib/fs-zds'; fsZds.readFile('/project/main.kcl')`,
      errors: [{ messageId: 'directFileSystemIo' }],
    },
    {
      code: `import backing from '@src/lib/fs-zds/index'; backing['writeFile']('/project/main.kcl', bytes)`,
      errors: [{ messageId: 'directFileSystemIo' }],
    },
    {
      code: `import { default as backing } from '@src/lib/fs-zds/index.ts'; backing.rm('/project', { recursive: true })`,
      errors: [{ messageId: 'directFileSystemIo' }],
    },
    {
      code: `import backing from '@src/lib/fs-zds'; backing.access('/project')`,
      errors: [{ messageId: 'directFileSystemIo' }],
    },
    {
      code: `import fsZds from '@src/lib/fs-zds'; const write = fsZds.writeFile`,
      errors: [{ messageId: 'directFileSystemIo' }],
    },
    {
      code: `import fsZds from '@src/lib/fs-zds'; const { writeFile } = fsZds`,
      errors: [{ messageId: 'escapedFileSystem' }],
    },
    {
      code: `import fsZds from '@src/lib/fs-zds'; ({ rm } = fsZds)`,
      errors: [{ messageId: 'escapedFileSystem' }],
    },
    {
      code: `import fsZds from '@src/lib/fs-zds'; const backing = fsZds; backing.readFile('/project/main.kcl')`,
      errors: [{ messageId: 'escapedFileSystem' }],
    },
    {
      code: `import fsZds from '@src/lib/fs-zds'; inspect(fsZds)`,
      errors: [{ messageId: 'escapedFileSystem' }],
    },
    {
      code: `import fsZds from '@src/lib/fs-zds'; fsZds[method]('/project/main.kcl')`,
      errors: [{ messageId: 'dynamicFileSystemAccess' }],
    },
  ],
})
