import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { once } from 'node:events'
import { createFileOperationsRuntime } from '@src/lib/fileSystem/runtime'
import nodefs from '@src/lib/fs-zds/nodefs'
import { replaceMigrationFiles } from '@src/lib/kclMigration/apply'
import { MigrationController } from '@src/lib/kclMigration/controller'
import type {
  MigrationClientMessage,
  MigrationOperation,
  MigrationRequest,
} from '@src/lib/kclMigration/protocol'
import { readProjectFiles } from '@src/lib/kclMigration/snapshot'
import { WebSocketServer, type WebSocket } from 'ws'
import { vi } from 'vitest'

export const sourceCode = '@settings(kclVersion = 2.0)\nlength = 10mm\n'
export const targetCode =
  '@settings(kclVersion = "3.0-preview")\nlength = 10mm\n'

export function successfulOperation(
  request: MigrationRequest
): MigrationOperation {
  return {
    id: request.request_id,
    project_snapshot: request.project_snapshot,
    target: request.target,
    status: 'succeeded',
    deadline: new Date(Date.now() + 20 * 60_000).toISOString(),
    result: {
      status: 'succeeded',
      detail: 'Conversion and validation passed.',
      files: {
        ...request.current_files,
        'main.kcl': Array.from(new TextEncoder().encode(targetCode)),
      },
      validation: {
        source_version: '2.0',
        target: '3.0-preview',
        runtime_version: '0.3.186',
        rules_revision: 'migration-guide-test',
        summary: 'Physical properties and parameter checks passed.',
        source_executed: true,
        target_executed: true,
        geometry_preserved: true,
        behavior_preserved: true,
      },
    },
  }
}

/** Real filesystem and WebSocket boundary; tests choose the server's terminal response. */
export async function migrationFixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'zds-migration-'))
  await mkdir(path.join(root, 'parts'))
  await writeFile(path.join(root, 'main.kcl'), sourceCode)
  await writeFile(
    path.join(root, 'parts', 'part.kcl'),
    '@settings(kclVersion = 2.0)\nx = 1\n'
  )
  await writeFile(
    path.join(root, 'asset.bin'),
    new Uint8Array([0, 255, 128, 1])
  )
  const runtime = createFileOperationsRuntime(nodefs.impl)
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  await once(server, 'listening')
  const address = server.address()
  assert(address && typeof address !== 'string', 'Missing test server address')
  vi.stubEnv('VITE_ZOO_API_BASE_URL', `http://127.0.0.1:${address.port}`)
  const frames: MigrationClientMessage[] = []
  let socket: WebSocket | undefined
  let request: MigrationRequest | undefined
  let current = true
  server.on('connection', (connected) => {
    socket = connected
    connected.on('message', (data) => {
      const frame: MigrationClientMessage = JSON.parse(data.toString())
      frames.push(frame)
      if (frame.type === 'start') {
        request = frame.request
        const operation = successfulOperation(request)
        connected.send(
          JSON.stringify({
            type: 'operation',
            operation: { ...operation, result: undefined, status: 'running' },
          })
        )
      }
    })
  })
  const project = {
    capture: async () => ({
      projectId: 'local:test-project',
      entrypoint: 'main.kcl',
      files: await readProjectFiles(runtime.operations, path, root),
    }),
    isCurrent: () => current,
    apply: async (
      expected: Map<string, Uint8Array>,
      replacement: Map<string, Uint8Array>
    ) => {
      await runtime.operations.withDirectoryLock(root, (files) =>
        replaceMigrationFiles({
          files,
          paths: path,
          root,
          expected,
          replacement,
          isCurrent: () => current,
        })
      )
      return undefined
    },
  }
  const controller = new MigrationController(project, () => 'test-token')
  return {
    root,
    runtime,
    controller,
    frames,
    project,
    leaveProject: () => {
      current = false
    },
    readMain: () => readFile(path.join(root, 'main.kcl'), 'utf8'),
    send: (operation: MigrationOperation) =>
      socket?.send(JSON.stringify({ type: 'operation', operation })),
    get request() {
      assert(request, 'No start received')
      return request
    },
    disconnect: () => socket?.terminate(),
    dispose: async () => {
      controller.dispose()
      for (const client of server.clients) client.terminate()
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      )
      await runtime.dispose()
      await rm(root, { recursive: true, force: true })
      vi.unstubAllEnvs()
    },
  }
}
