import { RuleTester } from 'eslint'
import { afterAll, describe, it } from 'vitest'
import rule from './no-internal-file-system-imports.mjs'

RuleTester.afterAll = afterAll
RuleTester.describe = describe
RuleTester.it = it

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
})

ruleTester.run('no-internal-file-system-imports', rule, {
  valid: [
    `import { FileAlreadyExists } from '@src/lib/fileSystem/fileOperations'`,
    `import fsZds from '@src/lib/fs-zds'`,
    `export { FileOperations } from '@src/lib/fileSystem/fileOperations'`,
    `const localValue = 1; export { localValue }`,
  ],
  invalid: [
    {
      code: `import { FileSystem } from '@src/lib/fileSystem/fileSystem'`,
      errors: [{ messageId: 'internalFileSystemImport' }],
    },
    {
      code: `export { FileNotFound } from '@src/lib/fileSystem/fileSystem.ts'`,
      errors: [{ messageId: 'internalFileSystemImport' }],
    },
    {
      code: `export * from '@src/lib/fileSystem/fileSystem'`,
      errors: [{ messageId: 'internalFileSystemImport' }],
    },
    {
      code: `const fileSystem = await import('@src/lib/fileSystem/fileSystem')`,
      errors: [{ messageId: 'internalFileSystemImport' }],
    },
  ],
})
