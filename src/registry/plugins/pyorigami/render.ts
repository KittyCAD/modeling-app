import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { isErr } from '@src/lib/trap'
import { isArray, isRecord } from '@src/lib/utils'
import type {
  PyorigamiRenderResult,
  PyorigamiAuthorResult,
} from '@src/registry/plugins/pyorigami/ipc'
import runner from './render.py?raw'
import authoring from '@src/lib/pyorigami/authoring.py?raw'
import authorRunner from './author.py?raw'
import {
  parseAuthoringOutput,
  type AuthoringOperation,
} from '@src/lib/pyorigami/authoringTypes'

export function parseRenderResult(value: unknown): PyorigamiRenderResult {
  if (
    isRecord(value) &&
    value.ok === true &&
    isArray(value.pages) &&
    value.pages.length > 0 &&
    value.pages.every((page): page is string => typeof page === 'string')
  )
    return {
      ok: true,
      pages: [...value.pages],
      authoring: parseAuthoringOutput(value.authoring),
    }
  return { ok: false, error: 'pyOrigami returned an invalid SVG result.' }
}

export async function executePyorigami(
  contents: string,
  src: string,
  signal: AbortSignal
): Promise<PyorigamiRenderResult> {
  const result = await runPyorigamiPython(
    `${authoring}\n${runner}`,
    { contents, src: src || 'untitled.origami.py' },
    signal
  )
  return result instanceof Error
    ? { ok: false, error: result.message }
    : parseRenderResult(result)
}

export async function executeAuthoring(
  contents: string,
  operation: AuthoringOperation,
  signal: AbortSignal
): Promise<PyorigamiAuthorResult> {
  const result = await runPyorigamiPython(
    `${authoring}\n${authorRunner}`,
    { contents, operation },
    signal
  )
  if (result instanceof Error) return { ok: false, error: result.message }
  if (
    isRecord(result) &&
    result.ok === true &&
    typeof result.contents === 'string'
  )
    return { ok: true, contents: result.contents }
  return {
    ok: false,
    error:
      isRecord(result) && typeof result.error === 'string'
        ? result.error
        : 'Invalid authoring result.',
  }
}

/** A source snapshot owns its process tree and temporary output directory until completion. */
export async function runPyorigamiPython(
  program: string,
  request: unknown,
  signal: AbortSignal
): Promise<unknown> {
  if (signal.aborted) return new Error('pyOrigami operation was cancelled.')
  const directory = await mkdtemp(path.join(os.tmpdir(), 'zds-pyorigami-'))
  try {
    return await new Promise<unknown>((resolve) => {
      const child = spawn(
        process.env.ZDS_PYORIGAMI_PYTHON ?? 'python3',
        ['-u', '-c', program],
        {
          cwd: directory,
          detached: process.platform !== 'win32',
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe'],
        }
      )
      let stdout = ''
      let stderr = ''
      let bytes = 0
      let failure: string | undefined
      const stop = (message: string) => {
        failure ??= message
        if (!child.pid) return
        try {
          if (process.platform === 'win32') child.kill('SIGKILL')
          else process.kill(-child.pid, 'SIGKILL')
        } catch {
          // The child may have exited between the signal and the kill request.
        }
      }
      const cancel = () => stop('pyOrigami operation was cancelled.')
      signal.addEventListener('abort', cancel, { once: true })
      if (signal.aborted) cancel()
      const timeout = setTimeout(
        () => stop('pyOrigami rendering exceeded 30 seconds.'),
        30_000
      )
      const append = (chunk: Buffer, error: boolean) => {
        bytes += chunk.length
        if (bytes > 16 * 1024 * 1024) {
          stop('pyOrigami output exceeded 16 MB.')
          return
        }
        if (error) stderr += chunk.toString('utf8')
        else stdout += chunk.toString('utf8')
      }
      child.stdout.on('data', (chunk: Buffer) => append(chunk, false))
      child.stderr.on('data', (chunk: Buffer) => append(chunk, true))
      child.on('error', (error) => {
        failure = `Unable to start pyOrigami Python: ${error.message}. Set ZDS_PYORIGAMI_PYTHON to a Python environment with pyOrigami installed.`
      })
      child.stdin.on('error', () => {
        // Process termination can close stdin before the source has been written.
      })
      child.on('close', (code) => {
        clearTimeout(timeout)
        signal.removeEventListener('abort', cancel)
        if (failure || code !== 0) {
          resolve(
            new Error(
              failure ??
                (stderr.trim() || `pyOrigami exited with code ${code}.`)
            )
          )
          return
        }
        try {
          resolve(JSON.parse(stdout))
        } catch {
          resolve(new Error('Unable to read the pyOrigami result.'))
        }
      })
      child.stdin.end(JSON.stringify(request))
    })
  } catch (cause) {
    return isErr(cause) ? cause : new Error(String(cause))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
