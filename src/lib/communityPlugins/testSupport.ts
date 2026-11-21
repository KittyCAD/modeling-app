import {
  FileNotFound,
  type FileContents,
} from '@src/lib/fileSystem/fileOperations'
import { createFilePluginStorage } from '@src/lib/communityPlugins/persistence'
import { compilePlugin } from '@src/lib/communityPlugins/source'

/** Test filesystem boundary retains the actual serialized TOML between application lifetimes. */
export function pluginStorageFixture(initial?: string) {
  let contents = initial
  let failure: Error | undefined
  let beforeWrite: (() => Promise<void>) | undefined
  const operations = {
    readFile: async (path: string) =>
      contents === undefined
        ? Promise.reject(
            new FileNotFound({
              path,
              operation: 'read-file',
              message: 'Missing file',
              cause: undefined,
            })
          )
        : new TextEncoder().encode(contents),
    writeFile: async (_path: string, value: FileContents) => {
      if (failure) return Promise.reject(failure)
      await beforeWrite?.()
      contents =
        typeof value === 'string' ? value : new TextDecoder().decode(value)
    },
  }
  return {
    operations,
    storage: createFilePluginStorage(
      operations,
      '/user/community-plugins.toml'
    ),
    get contents() {
      return contents
    },
    set contents(value: string | undefined) {
      contents = value
    },
    beforeWrite: (hook: (() => Promise<void>) | undefined) => {
      beforeWrite = hook
    },
    failWrites: (error: Error | undefined) => {
      failure = error
    },
  }
}

export function helloPlugin(
  message = 'Hello!',
  permissions = ['ui.notify'],
  id = 'hello'
) {
  return `/* @zds-plugin
id = "${id}"
name = "Hello"
api_version = 1
permissions = ${JSON.stringify(permissions)}
*/
export default zds => zds.contribute('command', { id: 'hello', title: 'Say hello', run: () => zds.ui.notify(${JSON.stringify(message)}) })`
}

export async function compiledHello(
  message = 'Hello!',
  permissions = ['ui.notify']
) {
  return compilePlugin(helloPlugin(message, permissions))
}
