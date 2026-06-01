import { PROJECT_FOLDER, PROJECT_SETTINGS_FILE_NAME } from '@src/lib/constants'
import {
  type ProjectArchiveFile,
  type ProjectManifest,
  getOpfsCloudProjectRoot,
  prepareProjectFilesForCloudUpload,
  projectManifestsEqual,
} from '@src/lib/fs-zds/opfsCloud'
import { describe, expect, it } from 'vitest'

const encoder = new TextEncoder()

function projectFile(relativePath: string, contents = ''): ProjectArchiveFile {
  return {
    relativePath,
    data: encoder.encode(contents),
  }
}

describe('opfsCloud sync helpers', () => {
  it('identifies project roots beneath the OPFS project directory', () => {
    expect(
      getOpfsCloudProjectRoot(`/documents/${PROJECT_FOLDER}/bracket/main.kcl`)
    ).toBe(`/documents/${PROJECT_FOLDER}/bracket`)

    expect(
      getOpfsCloudProjectRoot(
        `/documents/${PROJECT_FOLDER}/bracket/nested/part.kcl`
      )
    ).toBe(`/documents/${PROJECT_FOLDER}/bracket`)

    expect(
      getOpfsCloudProjectRoot(`/documents/${PROJECT_FOLDER}`)
    ).toBeUndefined()
  })

  it('normalizes Windows separators when identifying project roots', () => {
    expect(
      getOpfsCloudProjectRoot(
        `\\documents\\${PROJECT_FOLDER}\\bracket\\main.kcl`
      )
    ).toBe(`/documents/${PROJECT_FOLDER}/bracket`)
  })

  it('compares manifests by path, size, and content hash without depending on object key order', () => {
    const left: ProjectManifest = {
      files: {
        'main.kcl': { byteSize: 10, sha256: 'a' },
        'nested/part.kcl': { byteSize: 20, sha256: 'b' },
      },
    }
    const right: ProjectManifest = {
      files: {
        'nested/part.kcl': { byteSize: 20, sha256: 'b' },
        'main.kcl': { byteSize: 10, sha256: 'a' },
      },
    }
    const changed: ProjectManifest = {
      files: {
        'main.kcl': { byteSize: 10, sha256: 'a' },
        'nested/part.kcl': { byteSize: 21, sha256: 'b' },
      },
    }

    expect(projectManifestsEqual(left, right)).toBe(true)
    expect(projectManifestsEqual(left, changed)).toBe(false)
    expect(projectManifestsEqual(left, undefined)).toBe(false)
  })

  it('includes API-required entrypoint and project.toml paths in project upload metadata', () => {
    const payload = prepareProjectFilesForCloudUpload('/projects/bracket', [
      projectFile('nested/part.kcl'),
      projectFile(
        PROJECT_SETTINGS_FILE_NAME,
        'default_file = "nested/part.kcl"\n'
      ),
    ])

    expect(payload.body).toMatchObject({
      title: 'bracket',
      entrypoint_path: 'nested/part.kcl',
      project_toml_path: PROJECT_SETTINGS_FILE_NAME,
    })
    expect(payload.files.map((file) => file.relativePath)).toEqual([
      'nested/part.kcl',
      PROJECT_SETTINGS_FILE_NAME,
    ])
  })

  it('adds a project.toml upload file when local project settings are missing', () => {
    const payload = prepareProjectFilesForCloudUpload('/projects/bracket', [
      projectFile('main.kcl'),
    ])

    expect(payload.body.entrypoint_path).toBe('main.kcl')
    expect(payload.body.project_toml_path).toBe(PROJECT_SETTINGS_FILE_NAME)
    expect(payload.files.map((file) => file.relativePath)).toEqual([
      'main.kcl',
      PROJECT_SETTINGS_FILE_NAME,
    ])
    expect(
      new TextDecoder().decode(
        payload.files.find(
          (file) => file.relativePath === PROJECT_SETTINGS_FILE_NAME
        )?.data
      )
    ).toBe('default_file = "main.kcl"\n')
  })
})
