import path from 'node:path'
import { getWindowIconPath } from '@src/lib/windowIcon'
import { describe, expect, it } from 'vitest'

describe('getWindowIconPath', () => {
  it('loads the packaged icon independently of the working directory', () => {
    expect(
      getWindowIconPath({
        isPackaged: true,
        resourcesPath: path.join(path.sep, 'app-image', 'resources'),
        workingDirectory: path.join(path.sep, 'arbitrary', 'launch-directory'),
      })
    ).toBe(path.join(path.sep, 'app-image', 'resources', 'icon.png'))
  })

  it('loads the repository icon during development', () => {
    expect(
      getWindowIconPath({
        isPackaged: false,
        resourcesPath: path.join(path.sep, 'unused', 'resources'),
        workingDirectory: path.join(path.sep, 'modeling-app'),
      })
    ).toBe(path.join(path.sep, 'modeling-app', 'assets', 'icon.png'))
  })
})
