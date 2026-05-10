import type { SourceRange } from '@rust/kcl-lib/bindings/SourceRange'
import type { WarningLevel } from '@rust/kcl-lib/bindings/WarningLevel'
import { changeExperimentalFeatures } from '@src/lang/wasm'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { err } from '@src/lib/trap'
import { toUtf16 } from '@src/lang/errors'

export type RollbackEditSession = {
  previousExperimentalFeatures: WarningLevel | null | undefined
  changedExperimentalFeatures: boolean
  isManual: boolean
}

export function findTopLevelRollbackExit(code: string):
  | {
      range: SourceRange
      lineStart: number
      lineEnd: number
    }
  | undefined {
  let lineStart = 0
  let depth = 0
  const encoder = new TextEncoder()
  for (const line of code.split(/(?<=\n)/)) {
    const trimmed = line.trim()
    const isCandidate = depth === 0 && /^exit\(\)\s*;?$/.test(trimmed)
    const lineEnd = lineStart + line.length
    if (isCandidate) {
      const start = encoder.encode(code.slice(0, lineStart)).length
      const end = encoder.encode(code.slice(0, lineEnd)).length
      return { range: [start, end, 0], lineStart, lineEnd }
    }
    depth += braceDelta(line)
    lineStart = lineEnd
  }
  return undefined
}

export function removeRollbackExit(code: string): string {
  const marker = findTopLevelRollbackExit(code)
  if (!marker) {
    return code
  }
  return code.slice(0, marker.lineStart) + code.slice(marker.lineEnd)
}

export function insertRollbackExitAfterRange(
  code: string,
  sourceRange: SourceRange
): string {
  const withoutExisting = removeRollbackExit(code)
  const insertAt = endOfLineContainingUtf8Offset(
    withoutExisting,
    sourceRange[1]
  )
  const before = withoutExisting.slice(0, insertAt)
  const after = withoutExisting.slice(insertAt)
  const needsLeadingNewline = before.length > 0 && !before.endsWith('\n')
  return `${before}${needsLeadingNewline ? '\n' : ''}exit()\n${after}`
}

export function moveRollbackExitAfterRange(
  code: string,
  sourceRange: SourceRange | undefined
): string {
  if (!sourceRange) {
    return removeRollbackExit(code)
  }
  return insertRollbackExitAfterRange(code, sourceRange)
}

export function ensureExperimentalFeaturesAllow(input: {
  code: string
  previousExperimentalFeatures: WarningLevel | null | undefined
  wasmInstance: ModuleType
}): string | Error {
  if (input.previousExperimentalFeatures?.type === 'Allow') {
    return input.code
  }
  const changed = changeExperimentalFeatures(
    input.code,
    { type: 'Allow' },
    input.wasmInstance
  )
  if (err(changed)) {
    return changed
  }
  return changed
}

export function restoreExperimentalFeatures(input: {
  code: string
  previousExperimentalFeatures: WarningLevel | null | undefined
  wasmInstance: ModuleType
}): string | Error {
  const changed = changeExperimentalFeatures(
    input.code,
    input.previousExperimentalFeatures ?? null,
    input.wasmInstance
  )
  if (err(changed)) {
    return changed
  }
  return changed
}

function endOfLineContainingUtf8Offset(code: string, utf8Offset: number) {
  const utf16Offset = toUtf16(utf8Offset, code)
  const nextNewline = code.indexOf('\n', utf16Offset)
  return nextNewline === -1 ? code.length : nextNewline + 1
}

function braceDelta(line: string) {
  let delta = 0
  let inString: string | undefined
  let escaped = false
  for (const char of line) {
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === inString) {
        inString = undefined
      }
      continue
    }
    if (char === '"' || char === "'") {
      inString = char
      continue
    }
    if (char === '{') delta += 1
    if (char === '}') delta -= 1
  }
  return delta
}
