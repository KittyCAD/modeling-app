import { posix, win32 } from '@chainner/node-path'
import fc from 'fast-check'
import { expect, it } from 'vitest'
import noopfs from '@src/lib/fs-zds/noopfs'
import { createMemoryFileSystem } from '@src/lib/fs-zds/memory'

const operation = fc.record({
  kind: fc.constantFrom('mkdir', 'write', 'rename', 'copy', 'remove'),
  source: fc.integer({ min: 0, max: 3 }),
  destination: fc.integer({ min: 0, max: 3 }),
  file: fc.integer({ min: 0, max: 3 }),
  bytes: fc.uint8Array({ maxLength: 16 }),
})

for (const [name, paths] of [
  ['POSIX', posix],
  ['Windows', win32],
] as const) {
  it(`keeps directory listings and file bytes consistent through generated ${name} mutation histories`, async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(operation, { maxLength: 40 }),
        async (history) => {
          const fs = createMemoryFileSystem({ ...noopfs.impl, ...paths })
          const root = paths.resolve('/history')
          await fs.mkdir(root, { recursive: true })
          const model = new Map<number, Map<number, Uint8Array>>()
          const directory = (index: number) => paths.join(root, `dir-${index}`)
          for (const step of history) {
            const source = model.get(step.source)
            const target = model.get(step.destination)
            switch (step.kind) {
              case 'mkdir':
                await fs.mkdir(directory(step.source), { recursive: true })
                if (!source) model.set(step.source, new Map())
                break
              case 'write': {
                const path = paths.join(
                  directory(step.source),
                  `file-${step.file}`
                )
                if (!source)
                  await expect(
                    fs.writeFile(path, step.bytes)
                  ).rejects.toMatchObject({ code: 'ENOENT' })
                else {
                  await fs.writeFile(path, step.bytes)
                  source.set(step.file, new Uint8Array(step.bytes))
                }
                break
              }
              case 'remove':
                await fs.rm(directory(step.source), {
                  recursive: true,
                  force: true,
                })
                model.delete(step.source)
                break
              case 'copy':
                if (!source || target || step.source === step.destination)
                  await expect(
                    fs.cp(directory(step.source), directory(step.destination), {
                      recursive: true,
                      force: false,
                    })
                  ).rejects.toThrow()
                else {
                  await fs.cp(
                    directory(step.source),
                    directory(step.destination),
                    { recursive: true, force: false }
                  )
                  model.set(
                    step.destination,
                    new Map(
                      [...source].map(([key, bytes]) => [
                        key,
                        new Uint8Array(bytes),
                      ])
                    )
                  )
                }
                break
              case 'rename':
                if (
                  !source ||
                  (step.source !== step.destination && target?.size)
                )
                  await expect(
                    fs.rename(
                      directory(step.source),
                      directory(step.destination)
                    )
                  ).rejects.toThrow()
                else {
                  await fs.rename(
                    directory(step.source),
                    directory(step.destination)
                  )
                  model.delete(step.source)
                  model.set(step.destination, source)
                }
            }
            expect((await fs.readdir(root)).sort()).toEqual(
              [...model.keys()].map((index) => `dir-${index}`).sort()
            )
            for (const [index, files] of model) {
              expect((await fs.readdir(directory(index))).sort()).toEqual(
                [...files.keys()].map((file) => `file-${file}`).sort()
              )
              for (const [file, bytes] of files)
                expect(
                  await fs.readFile(
                    paths.join(directory(index), `file-${file}`)
                  )
                ).toEqual(bytes)
            }
          }
        }
      ),
      { numRuns: 100 }
    )
  })
}

it('keeps cloud names exact even when its path functions use Windows spelling rules', async () => {
  const fs = createMemoryFileSystem({ ...noopfs.impl, ...win32 })
  const root = win32.resolve('/cloud')
  const source = win32.join(root, 'Part')
  const destination = win32.join(root, 'part')
  await fs.mkdir(source, { recursive: true })
  await fs.writeFile(win32.join(source, 'Contents'), new Uint8Array([1]))
  await fs.rename(source, destination)
  expect(await fs.readdir(root)).toEqual(['part'])
  await expect(fs.stat(source)).rejects.toMatchObject({ code: 'ENOENT' })
  await fs.cp(destination, source, { recursive: true })
  await fs.writeFile(win32.join(source, 'Contents'), new Uint8Array([2]))
  expect((await fs.readdir(root)).sort()).toEqual(['Part', 'part'])
  expect(await fs.readFile(win32.join(destination, 'Contents'))).toEqual(
    new Uint8Array([1])
  )
  expect(() =>
    fs.replaceDirectory(source, [
      { path: win32.join(destination, 'escape'), data: new Uint8Array([3]) },
    ])
  ).toThrow()
  expect(await fs.readFile(win32.join(source, 'Contents'))).toEqual(
    new Uint8Array([2])
  )
})
