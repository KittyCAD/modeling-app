import * as assert from 'assert'
import { chmod, mkdtemp, stat, writeFile } from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { suite, test } from 'mocha'
import { removeVSCodeProfile } from '../vscodeProfile'

suite('VS Code profile cleanup', () => {
  test('removes a profile containing a read-only file', async () => {
    const profileDir = await mkdtemp(path.join(os.tmpdir(), 'kcl-ls-cleanup-'))
    const profileFile = path.join(profileDir, 'settings.json')
    await writeFile(profileFile, '{}')

    try {
      await chmod(profileFile, 0o444)
      await removeVSCodeProfile(profileDir)
      await assert.rejects(stat(profileDir), { code: 'ENOENT' })
    } finally {
      // Allow cleanup even if the regression leaves the read-only file behind.
      await chmod(profileFile, 0o666).catch((error: NodeJS.ErrnoException) => {
        assert.strictEqual(error.code, 'ENOENT')
      })
      await removeVSCodeProfile(profileDir)
    }
  }).timeout(15_000)
})
