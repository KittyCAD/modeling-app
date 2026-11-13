import { expect, type Page } from '@playwright/test'

export async function holdFileRead(page: Page, name: string) {
  return page.evaluateHandle((name) => {
    const file = window.app.project?.files.find(
      (file) => window.fsZds.basename(file.path) === name
    )
    if (!file) throw new Error(`Missing file: ${name}`)
    const read = file.read.bind(file)
    const gate = Promise.withResolvers<undefined>()
    file.read = async () => {
      await gate.promise
      return read()
    }
    return () => {
      file.read = read
      gate.resolve(undefined)
    }
  }, name)
}

export async function holdModelingOpen(page: Page) {
  return page.evaluateHandle(() => {
    const rust = window.app.rustContext
    const open = rust.sendOpenProject.bind(rust)
    const update = rust.sendUpdateFile.bind(rust)
    const sourceId = window.app.singletons.kclManager.id
    const gate = Promise.withResolvers<undefined>()
    let ready = false
    let updatesBeforeReady = 0
    rust.sendUpdateFile = async (...args) => {
      if (!ready && args[0] !== sourceId) updatesBeforeReady += 1
      return update(...args)
    }
    rust.sendOpenProject = async (...args) => {
      await gate.promise
      return open(...args)
    }
    return () => {
      rust.sendOpenProject = open
      rust.sendUpdateFile = update
      ready = true
      gate.resolve(undefined)
      return updatesBeforeReady
    }
  })
}

export async function holdEditorWrites(page: Page, path: string) {
  return page.evaluateHandle((targetPath) => {
    const io = window.app.singletons.kclManager.textFileIO
    const write = io.write.bind(io)
    const gate = Promise.withResolvers<undefined>()
    const contents: string[] = []
    Object.assign(io, {
      write: async (path: string, code: string) => {
        if (path === targetPath) {
          contents.push(code)
          await gate.promise
        }
        return write(path, code)
      },
    })
    return {
      started: () => contents.length > 0,
      contents: () => contents,
      release: () => gate.resolve(undefined),
      restore: () => Object.assign(io, { write }),
    }
  }, path)
}

export function readEditorCode(page: Page) {
  return page.evaluate(() => window.app.singletons.kclManager.code)
}

export async function expandFileTreeFolder(page: Page, name: string) {
  const folder = page.getByRole('treeitem', { name, exact: true })
  if ((await folder.getAttribute('aria-expanded')) !== 'true')
    await folder.click()
  await expect(folder).toHaveAttribute('aria-expanded', 'true')
}
