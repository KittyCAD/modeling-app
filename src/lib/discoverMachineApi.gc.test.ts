import { spawn } from 'node:child_process'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

interface ProbeResult {
  code: number | null
  stdout: string
  stderr: string
  timedOut: boolean
}

interface ProbePayload {
  mode: string
  iterations: number
  timeoutAfterMs: number
  baseline: Record<string, number>
  after: Record<string, number>
}

const runProbe = async (
  mode: 'clean' | 'leaky',
  timeoutMs: number
): Promise<ProbeResult> => {
  const probeScriptPath = path.join(
    process.cwd(),
    'src/lib/discoverMachineApi.gcProbe.ts'
  )

  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [
        '--expose-gc',
        '-r',
        'ts-node/register/transpile-only',
        '-r',
        'tsconfig-paths/register',
        probeScriptPath,
        mode,
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          TS_NODE_BASEURL: '.',
          TS_NODE_PROJECT: 'tsconfig.json',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    )

    let stdout = ''
    let stderr = ''
    let timedOut = false

    const timeout = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, timeoutMs)

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    child.on('close', (code) => {
      clearTimeout(timeout)
      resolve({ code, stdout, stderr, timedOut })
    })
  })
}

const parseProbePayload = (stdout: string): ProbePayload => {
  return JSON.parse(stdout.trim()) as ProbePayload
}

describe('discoverMachineApi gc regression', () => {
  it('does not leak socket handles after repeated discovery calls', async () => {
    const result = await runProbe('clean', 20_000)

    expect(result.timedOut).toBe(false)
    expect(result.code).toBe(0)
    expect(result.stderr).toBe('')

    const payload = parseProbePayload(result.stdout)
    const baselineSockets = payload.baseline.Socket ?? 0
    const afterSockets = payload.after.Socket ?? 0

    expect(afterSockets).toBeLessThanOrEqual(baselineSockets + 2)
  })
})
