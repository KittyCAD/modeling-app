import { spawn } from 'node:child_process'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

interface ProbeResult {
  code: number | null
  stderr: string
  timedOut: boolean
}

const runProbe = async (timeoutMs: number): Promise<ProbeResult> => {
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
        '40',
        '10',
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

    let stderr = ''
    let timedOut = false

    const timeout = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, timeoutMs)

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    child.on('close', (code) => {
      clearTimeout(timeout)
      resolve({ code, stderr, timedOut })
    })
  })
}

describe('discoverMachineApi gc regression', () => {
  it('exits after repeated discovery calls', async () => {
    const result = await runProbe(20_000)

    expect(result.timedOut).toBe(false)
    expect(result.code).toBe(0)
    expect(result.stderr).toBe('')
  })
})
