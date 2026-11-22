import { createPublicationArchiveValidator } from '@src/lib/publishing/validateProjectArchive'
import { loadWasm } from '@src/unitTestUtils'
import { beforeAll, expect, it } from 'vitest'

let validate: ReturnType<typeof createPublicationArchiveValidator>
beforeAll(() => {
  validate = createPublicationArchiveValidator(loadWasm())
})
const file = (relativePath: string, contents: string) => ({
  relativePath,
  data: new TextEncoder().encode(contents),
})

it('validates the configured entrypoint instead of an unrelated KCL file', async () => {
  await expect(
    validate([
      file(
        'project.toml',
        'title = "Bracket"\ndefault_file = "parts/entry.kcl"'
      ),
      file('parts/entry.kcl', '@settings(kclVersion = 3.0)\nwidth = 2'),
      file('main.kcl', 'broken KCL ???'),
    ])
  ).resolves.toBeUndefined()
})

it('rejects empty, malformed, missing KCL and malformed project configuration', async () => {
  for (const files of [
    [file('main.kcl', '@settings(kclVersion = 3.0)')],
    [file('main.kcl', 'broken KCL ???')],
    [file('README.md', 'No model')],
    [
      file('project.toml', '['),
      file('main.kcl', '@settings(kclVersion = 3.0)\nwidth = 2'),
    ],
  ])
    await expect(validate(files)).resolves.toBeInstanceOf(Error)
})
