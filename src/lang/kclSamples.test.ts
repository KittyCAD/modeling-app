import { assertParse, initPromise, programMemoryInit } from './wasm'
import { enginelessExecutor } from '../lib/testHelpers'
// These unit tests makes web requests to a public github repository.

interface KclSampleFile {
  file: string
  title: string
  filename: string
  description: string
}

beforeAll(async () => {
  await initPromise
})

// Only used to actually fetch an older version of KCL code that will break in the parser.
/* eslint-disable @typescript-eslint/no-unused-vars */
async function getBrokenSampleCodeForLocalTesting() {
  const result = await fetch(
    'https://raw.githubusercontent.com/KittyCAD/kcl-samples/5ccd04a1773ebdbfd02684057917ce5dbe0eaab3/80-20-rail.kcl'
  )
  const text = await result.text()
  return text
}

async function getKclSampleCodeFromGithub(file: string): Promise<string> {
  const result = await fetch(
    `https://raw.githubusercontent.com/KittyCAD/kcl-samples/refs/heads/main/${file}/${file}.kcl`
  )
  const text = await result.text()
  return text
}

async function getFileNamesFromManifestJSON(): Promise<KclSampleFile[]> {
  const result = await fetch(
    'https://raw.githubusercontent.com/KittyCAD/kcl-samples/refs/heads/main/manifest.json'
  )
  const json = await result.json()
  json.forEach((file: KclSampleFile) => {
    const filenameWithoutExtension = file.file.split('.')[0]
    file.filename = filenameWithoutExtension
  })
  return json
}

// Value to use across all tests!
let files: KclSampleFile[] = []

describe('Test KCL Samples from public Github repository', () => {
  describe('When parsing source code', () => {
    // THIS RUNS ACROSS OTHER TESTS!
    it('should fetch files', async () => {
      files = await getFileNamesFromManifestJSON()
    })
    // Run through all of the files in the manifest json. This will allow us to be automatically updated
    // with the latest changes in github. We won't be hard coding the filenames
    files.forEach((file: KclSampleFile) => {
      it(`should parse ${file.filename} without errors`, async () => {
        const code = await getKclSampleCodeFromGithub(file.filename)
        assertParse(code)
      }, 1000)
    })
  })

  describe('when performing enginelessExecutor', () => {
    it(
      'should run through all the files',
      async () => {
        for (let i = 0; i < files.length; i++) {
          const file: KclSampleFile = files[i]
          const code = await getKclSampleCodeFromGithub(file.filename)
          const ast = assertParse(code)
          await enginelessExecutor(ast, programMemoryInit())
        }
      },
      files.length * 1000
    )
  })
})
