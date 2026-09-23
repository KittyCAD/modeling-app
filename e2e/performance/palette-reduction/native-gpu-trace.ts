import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { ElectronApplication, TestInfo } from '@playwright/test'

type ToolResult = {
  exitCode: number | null
  error: 'timeout' | 'spawn-failed' | 'output-limit' | 'command-failed' | null
  startedEpochMs: number
  finishedEpochMs: number
  elapsedMs: number
}

interface TraceEvidence {
  diagnostic: string
  calibrationEligible: false
  target: string
  template: string
  recordLimitMs: number
  recordProcessDeadlineMs: number
  startedEpochMs: number
  subscriptionReadyEpochMs: number | null
  recordingReadyEpochMs: number | null
  finishRequestedEpochMs: number | null
  finishedEpochMs: number | null
  targetPid: number | null
  recording: ToolResult | null
  tocExport: ToolResult | null
  sampleSchemaExport: ToolResult | null
  schemaSanitizer: ToolResult | null
  timingEvidence: string
  error: string | null
}

function runTool(
  command: string,
  args: string[],
  timeoutMs: number,
  onOutput?: (chunk: string) => void
) {
  const started = Date.now()
  const child = spawn(command, args, {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let error: ToolResult['error'] = null
  let bytes = 0
  let closed = false
  const stop = () => {
    if (child.pid && !closed) {
      try {
        process.kill(-child.pid, 'SIGKILL')
      } catch {
        // The owned process group may have exited before cleanup.
      }
    }
  }
  const timer = setTimeout(() => {
    error = 'timeout'
    stop()
  }, timeoutMs)
  const done = new Promise<ToolResult>((resolve) => {
    child.on('error', () => {
      error = 'spawn-failed'
    })
    child.on('close', (exitCode) => {
      closed = true
      clearTimeout(timer)
      resolve({
        exitCode,
        error: error ?? (exitCode === 0 ? null : 'command-failed'),
        startedEpochMs: started,
        finishedEpochMs: Date.now(),
        elapsedMs: Date.now() - started,
      })
    })
  })
  const consume = (chunk: Buffer, notify: boolean) => {
    bytes += chunk.length
    if (bytes > 256 * 1024) {
      error = 'output-limit'
      stop()
      return
    }
    if (notify) onOutput?.(chunk.toString('utf8'))
  }
  child.stdout.on('data', (chunk: Buffer) => consume(chunk, true))
  child.stderr.on('data', (chunk: Buffer) => consume(chunk, false))
  return { done, stop }
}

async function notificationBeforeExit(
  notification: Promise<void>,
  tool: ReturnType<typeof runTool>,
  timeoutMs: number
) {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      notification.then(() => true),
      tool.done.then(() => false),
      new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

export async function startNativeGpuTrace(electron: ElectronApplication) {
  const evidence: TraceEvidence = {
    diagnostic: 'palette-native-gpu-trace',
    calibrationEligible: false,
    target: 'first-repetition-gpu-process',
    template: 'Game Performance',
    recordLimitMs: 15_000,
    recordProcessDeadlineMs: 45_000,
    startedEpochMs: Date.now(),
    subscriptionReadyEpochMs: null,
    recordingReadyEpochMs: null,
    finishRequestedEpochMs: null,
    finishedEpochMs: null,
    targetPid: null,
    recording: null,
    tocExport: null,
    sampleSchemaExport: null,
    schemaSanitizer: null,
    timingEvidence: 'unavailable-schema-not-interpreted',
    error: null,
  }
  let directory: string | undefined
  let recording: ReturnType<typeof runTool> | undefined
  let notifier: ReturnType<typeof runTool> | undefined
  try {
    if (process.platform !== 'darwin') {
      evidence.error = 'unsupported-platform'
    } else {
      const pid = await electron.evaluate(({ app }) => {
        const gpu = app.getAppMetrics().find((metric) => metric.type === 'GPU')
        return gpu && Number.isSafeInteger(gpu.pid) && gpu.pid > 0
          ? gpu.pid
          : null
      })
      if (pid === null) {
        evidence.error = 'gpu-process-unavailable'
      } else {
        evidence.targetPid = pid
        directory = await mkdtemp(path.join(tmpdir(), 'palette-native-trace-'))
        const key = `dev.zoo.palette-trace.${randomUUID()}`
        const startedKey = `${key}.started`
        const subscribedKey = `${key}.subscribed`
        let subscribed = () => {}
        let started = () => {}
        const subscriptionReady = new Promise<void>((resolve) => {
          subscribed = resolve
        })
        const recordingReady = new Promise<void>((resolve) => {
          started = resolve
        })
        let notificationOutput = ''
        // Registration precedes the self-post in this single notifyutil process.
        // Seeing the self-post proves the recording notification is subscribed.
        notifier = runTool(
          '/usr/bin/notifyutil',
          [
            '-z',
            '0',
            '-1',
            startedKey,
            '-1',
            subscribedKey,
            '-p',
            subscribedKey,
          ],
          20_000,
          (chunk) => {
            notificationOutput += chunk
            const lines = notificationOutput.split('\n')
            notificationOutput = lines.pop() ?? ''
            for (const line of lines) {
              if (line.trim() === subscribedKey) subscribed()
              if (line.trim() === startedKey) started()
            }
          }
        )
        if (
          !(await notificationBeforeExit(subscriptionReady, notifier, 3_000))
        ) {
          evidence.error = 'notification-subscription-unavailable'
        } else {
          evidence.subscriptionReadyEpochMs = Date.now()
          recording = runTool(
            'xcrun',
            [
              'xctrace',
              'record',
              '--template',
              'Game Performance',
              '--attach',
              String(pid),
              '--time-limit',
              '15s',
              '--no-prompt',
              '--notify-tracing-started',
              startedKey,
              '--output',
              path.join(directory, 'gpu.trace'),
            ],
            45_000
          )
          if (await notificationBeforeExit(recordingReady, notifier, 10_000)) {
            evidence.recordingReadyEpochMs = Date.now()
          } else {
            evidence.error = 'recording-readiness-unavailable'
            recording.stop()
          }
        }
      }
    }
  } catch {
    evidence.error = 'trace-start-failed'
    recording?.stop()
  } finally {
    notifier?.stop()
    await notifier?.done
  }

  return {
    async finish(testInfo: TestInfo) {
      evidence.finishRequestedEpochMs = Date.now()
      try {
        if (recording) evidence.recording = await recording.done
        if (
          directory &&
          evidence.recordingReadyEpochMs &&
          evidence.recording?.error === null
        ) {
          evidence.tocExport = await runTool(
            'xcrun',
            [
              'xctrace',
              'export',
              '--input',
              path.join(directory, 'gpu.trace'),
              '--toc',
              '--output',
              path.join(directory, 'toc.xml'),
            ],
            10_000
          ).done
          if (evidence.tocExport.error === null) {
            // Export a known CPU sampling table only for its field definitions.
            // Rows, stacks, paths, and timing values never enter the artifact.
            evidence.sampleSchemaExport = await runTool(
              'xcrun',
              [
                'xctrace',
                'export',
                '--input',
                path.join(directory, 'gpu.trace'),
                '--xpath',
                '/trace-toc/run[@number="1"]/data/table[@schema="time-sample"]',
                '--output',
                path.join(directory, 'sample.xml'),
              ],
              15_000
            ).done
            evidence.schemaSanitizer = await runTool(
              '/usr/bin/python3',
              [
                path.resolve(
                  'e2e/performance/palette-reduction/native-trace-schema.py'
                ),
                directory,
              ],
              5_000
            ).done
            if (evidence.schemaSanitizer.error === null) {
              await testInfo.attach('native-gpu-trace-schema', {
                body: await readFile(path.join(directory, 'schema.json')),
                contentType: 'application/json',
              })
            }
          }
        }
      } catch {
        evidence.error ??= 'trace-finish-failed'
      } finally {
        recording?.stop()
        await recording?.done
        if (directory) {
          try {
            await rm(directory, { recursive: true, force: true })
          } catch {
            evidence.error ??= 'private-trace-cleanup-failed'
          }
        }
        evidence.finishedEpochMs = Date.now()
        await testInfo.attach('native-gpu-trace-evidence', {
          body: JSON.stringify(evidence, null, 2),
          contentType: 'application/json',
        })
      }
    },
  }
}
