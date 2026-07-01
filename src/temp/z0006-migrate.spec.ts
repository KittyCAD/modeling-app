/*
 * Temporary Vitest runner for src/temp/z0006-migrate.ts.
 *
 * Example:
 *   ZOO_HOST=http://127.0.0.1:8080 \
 *   Z0006_MIGRATE_FILES=public/kcl-samples/bracket/main.kcl \
 *   npm test -- --run src/temp/z0006-migrate.spec.ts --project=integration
 *
 * Add Z0006_MIGRATE_WRITE=1 to write changes.
 *
 * Tip: large samples can trap in Node/Vitest with
 * `RuntimeError: memory access out of bounds` unless the wasm bundle is rebuilt
 * with a larger stack. While running this temporary migration, keep this local
 * rust/.cargo/config.toml flag in place, then rebuild with `npm run build:wasm:dev`:
 *
 *   "-C",
 *   "link-arg=-zstack-size=8388608",
 *
 * This fixed `public/kcl-samples/bracket/main.kcl`, which timed out at 180s
 * with the default wasm stack but migrated in ~15s with the larger stack.
 */

import { writeFile } from 'node:fs/promises'
import { relative, resolve } from 'node:path'

import { fsManager, projectFsManager } from '@src/lang/std/fileSystemManager'
import { StorageName, moduleFsViaModuleImport } from '@src/lib/fs-zds'
import nodefs from '@src/lib/fs-zds/nodefs'
import { buildTheWorldAndConnectToEngine } from '@src/unitTestUtils'
import { afterAll, describe, expect, it } from 'vitest'

import { migrateRawKclFile } from './z0006-migrate'

const files = (process.env.Z0006_MIGRATE_FILES ?? '')
  .split(/\r?\n|,/)
  .map((file) => file.trim())
  .filter(Boolean)

const shouldWrite = process.env.Z0006_MIGRATE_WRITE === '1'
const fileTimeoutMs = Number(
  process.env.Z0006_MIGRATE_FILE_TIMEOUT_MS ?? 30_000
)
const testTimeoutMs = Math.max(120_000, files.length * fileTimeoutMs + 60_000)

describe('temporary Z0006 sample migration runner', () => {
  let engineCommandManager:
    | Awaited<
        ReturnType<typeof buildTheWorldAndConnectToEngine>
      >['engineCommandManager']
    | undefined

  afterAll(() => {
    engineCommandManager?.tearDown()
  })

  it(
    'migrates configured raw KCL files',
    { timeout: testTimeoutMs, retry: 0 },
    async () => {
      expect(
        files.length,
        'Set Z0006_MIGRATE_FILES to one or more comma/newline-separated .kcl files'
      ).toBeGreaterThan(0)

      await moduleFsViaModuleImport({
        type: StorageName.NodeFS,
        options: {},
      })
      ;(fsManager as unknown as { _fs: typeof nodefs.impl })._fs = nodefs.impl
      ;(projectFsManager as unknown as { _fs: typeof nodefs.impl })._fs =
        nodefs.impl

      const {
        instance,
        kclManager,
        engineCommandManager: engine,
      } = await buildTheWorldAndConnectToEngine()
      engineCommandManager = engine

      const failures: string[] = []
      let changed = 0
      let unchanged = 0

      for (const inputFile of files) {
        const file = resolve(inputFile)
        const result = await withTimeout(
          migrateRawKclFile({
            file,
            kclManager,
            engineCommandManager: engine,
            wasmInstance: instance,
          }),
          fileTimeoutMs,
          file
        ).catch((error: unknown) => ({
          status: 'failed' as const,
          file,
          error: error instanceof Error ? error.message : String(error),
        }))

        const displayPath = relative(process.cwd(), file)
        if (result.status === 'failed') {
          failures.push(`${displayPath}: ${result.error}`)
          console.log(`[failed]  ${displayPath}: ${result.error}`)
          continue
        }

        if (result.status === 'changed') {
          changed += 1
          console.log(`[changed] ${displayPath}`)
          if (shouldWrite) {
            await writeFile(file, result.after)
            console.log(`[wrote]   ${displayPath}`)
          }
        } else {
          unchanged += 1
          console.log(`[ok]      ${displayPath} unchanged`)
        }
      }

      console.log(
        `Summary: ${changed} changed, ${unchanged} unchanged, ${failures.length} failed`
      )
      if (!shouldWrite && changed > 0) {
        console.log('Dry run only. Set Z0006_MIGRATE_WRITE=1 to update files.')
      }

      expect(failures).toEqual([])
    }
  )
})

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  file: string
): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`timed out after ${timeoutMs}ms: ${file}`))
    }, timeoutMs)
  })

  try {
    return await Promise.race([promise, timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
