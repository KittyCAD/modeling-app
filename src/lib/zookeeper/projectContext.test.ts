import type { FileMeta } from '@src/lib/types'
import { getZookeeperProjectFilesValidationError } from '@src/lib/zookeeper/projectContext'
import { describe, expect, it } from 'vitest'

function projectFile(relPath: string): FileMeta {
  return {
    type: 'other',
    relPath,
    data: new Blob(),
  }
}

describe('Zookeeper project context validation', () => {
  it('allows project settings at the current project root', () => {
    expect(
      getZookeeperProjectFilesValidationError([
        projectFile('main.kcl'),
        projectFile('project.toml'),
      ])
    ).toBeUndefined()
  })

  it.each(['subproject/project.toml', 'subproject\\PROJECT.TOML'])(
    'rejects nested project settings at %s',
    (relPath) => {
      expect(
        getZookeeperProjectFilesValidationError([
          projectFile('main.kcl'),
          projectFile(relPath),
        ])
      ).toEqual(
        new Error(
          `Zookeeper cannot use nested projects. Move "${relPath}" into a separate top-level project folder and try again.`
        )
      )
    }
  )
})
