import { promises as fs } from 'fs'
import path from 'path'
import os from 'os'
import { v4 as uuidv4 } from 'uuid'
import getCurrentProjectFile from './getCurrentProjectFile'

describe('getCurrentProjectFile', () => {
  test('with explicit open file with space (URL encoded)', async () => {
    const name = `kittycad-modeling-projects-${uuidv4()}`
    const tmpProjectDir = path.join(os.tmpdir(), name)

    await fs.mkdir(tmpProjectDir, { recursive: true })
    await fs.writeFile(path.join(tmpProjectDir, 'i have a space.kcl'), '')

    const state = await getCurrentProjectFile(
      path.join(tmpProjectDir, 'i%20have%20a%20space.kcl')
    )

    expect(state).toBe(path.join(tmpProjectDir, 'i have a space.kcl'))

    await fs.rm(tmpProjectDir, { recursive: true, force: true })
  })

  test('with explicit open file with space', async () => {
    const name = `kittycad-modeling-projects-${uuidv4()}`
    const tmpProjectDir = path.join(os.tmpdir(), name)

    await fs.mkdir(tmpProjectDir, { recursive: true })
    await fs.writeFile(path.join(tmpProjectDir, 'i have a space.kcl'), '')

    const state = await getCurrentProjectFile(
      path.join(tmpProjectDir, 'i have a space.kcl')
    )

    expect(state).toBe(path.join(tmpProjectDir, 'i have a space.kcl'))

    await fs.rm(tmpProjectDir, { recursive: true, force: true })
  })

  test('with source path dot', async () => {
    const name = `kittycad-modeling-projects-${uuidv4()}`
    const tmpProjectDir = path.join(os.tmpdir(), name)
    await fs.mkdir(tmpProjectDir, { recursive: true })

    // Set the current directory to the temp project directory.
    const originalCwd = process.cwd()
    process.chdir(tmpProjectDir)

    try {
      const state = await getCurrentProjectFile('.')

      if (state instanceof Error) {
        throw state
      }

      expect(state.replace('/private', '')).toBe(
        path.join(tmpProjectDir, 'main.kcl')
      )
    } finally {
      process.chdir(originalCwd)
      await fs.rm(tmpProjectDir, { recursive: true, force: true })
    }
  })

  test('with main.kcl not existing', async () => {
    const name = `kittycad-modeling-projects-${uuidv4()}`
    const tmpProjectDir = path.join(os.tmpdir(), name)
    await fs.mkdir(tmpProjectDir, { recursive: true })

    try {
      const state = await getCurrentProjectFile(tmpProjectDir)

      expect(state).toBe(path.join(tmpProjectDir, 'main.kcl'))
    } finally {
      await fs.rm(tmpProjectDir, { recursive: true, force: true })
    }
  })

  test('with directory, main.kcl not existing, other.kcl does', async () => {
    const name = `kittycad-modeling-projects-${uuidv4()}`
    const tmpProjectDir = path.join(os.tmpdir(), name)
    await fs.mkdir(tmpProjectDir, { recursive: true })
    await fs.writeFile(path.join(tmpProjectDir, 'other.kcl'), '')

    try {
      const state = await getCurrentProjectFile(tmpProjectDir)

      expect(state).toBe(path.join(tmpProjectDir, 'other.kcl'))

      // make sure we didn't create a main.kcl file
      await expect(
        fs.access(path.join(tmpProjectDir, 'main.kcl'))
      ).rejects.toThrow()
    } finally {
      await fs.rm(tmpProjectDir, { recursive: true, force: true })
    }
  })
})
