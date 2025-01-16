import { assertParse, initPromise, programMemoryInit } from './wasm'
import { enginelessExecutor } from '../lib/testHelpers'

import path from 'node:path'
import fs from 'node:fs/promises'
import child_process from 'node:child_process'

// The purpose of these tests is to act as a first line of defense
// if something gets real screwy with our KCL ecosystem.
// THESE TESTS ONLY RUN UNDER A NODEJS ENVIRONMENT. They DO NOT
// test under our application.

const DIR_KCL_SAMPLES = 'kcl-samples'
const URL_GIT_KCL_SAMPLES = 'https://github.com/KittyCAD/kcl-samples.git'

interface KclSampleFile {
  file: string
  pathFromProjectDirectoryToFirstFile: string
  title: string
  filename: string
  description: string
}

try {
  // @ts-expect-error
  await fs.rm(DIR_KCL_SAMPLES, { recursive: true })
} catch (e) {
  console.log(e)
}

child_process.spawnSync('git', [
  'clone',
  '--single-branch',
  '--branch',
  'achalmers/kwargs-line',
  URL_GIT_KCL_SAMPLES,
  DIR_KCL_SAMPLES,
])

// @ts-expect-error
let files = await fs.readdir(DIR_KCL_SAMPLES)
// @ts-expect-error
const manifestJsonStr = await fs.readFile(
  path.resolve(DIR_KCL_SAMPLES, 'manifest.json'),
  'utf-8'
)
const manifest = JSON.parse(manifestJsonStr)

process.chdir(DIR_KCL_SAMPLES)

beforeAll(async () => {
  await initPromise
})

afterAll(async () => {
  try {
    process.chdir('..')
    await fs.rm(DIR_KCL_SAMPLES, { recursive: true })
  } catch (e) {}
})

afterEach(() => {
  process.chdir('..')
})

// The tests have to be sequential because we need to change directories
// to support `import` working properly.
// @ts-expect-error
describe.sequential('Test KCL Samples from public Github repository', () => {
  // @ts-expect-error
  describe.sequential('when performing enginelessExecutor', () => {
    manifest.forEach((file: KclSampleFile) => {
      // @ts-expect-error
      it.sequential(
        `should execute ${file.title} (${file.file}) successfully`,
        async () => {
          const [dirProject, fileKcl] =
            file.pathFromProjectDirectoryToFirstFile.split('/')
          process.chdir(dirProject)
          const code = await fs.readFile(fileKcl, 'utf-8')
          const ast = assertParse(code)
          await enginelessExecutor(ast, programMemoryInit())
        },
        files.length * 1000
      )
    })
  })
})
