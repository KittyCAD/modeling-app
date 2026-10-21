import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import type { Fixtures } from '@e2e/playwright/fixtures/fixtureSetup'
import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'

export type ErrorModelProfile = 'large-syntax-error' | 'large-engine-error'
export type PerformanceModelProfile = 'small' | 'large' | ErrorModelProfile
export const ERROR_MODEL_PROFILES: readonly ErrorModelProfile[] = [
  'large-syntax-error',
  'large-engine-error',
]
export const MODEL_PROFILES: readonly PerformanceModelProfile[] = [
  'small',
  'large',
  ...ERROR_MODEL_PROFILES,
]

export function isErrorProfile(
  profile: PerformanceModelProfile | undefined
): profile is ErrorModelProfile {
  return profile === 'large-syntax-error' || profile === 'large-engine-error'
}

const largeModelSource = path.join('public', 'kcl-samples', 'cpu-cooler')
const largeModelImport = 'import "large-model/main.kcl" as performanceModel'
const SYNTAX_ERROR_TAIL =
  '\n// Intentional trailing KCL parse error for the performance profile.\nperformanceInvalid = (\n'
const ENGINE_ERROR_TAIL =
  '\n// Intentional trailing kernel failure for the performance profile.\nperformanceInvalid = fillet(boxVisible, edges = [{ sideFaces = [boxVisible.sketch.tags.line1, boxVisible.sketch.tags.line2] }], radius = 100000mm)\n'
const ENGINE_ERROR_MESSAGE =
  'Fillet blend creation encountered an internal error.'

function errorTail(profile: ErrorModelProfile) {
  return profile === 'large-syntax-error'
    ? SYNTAX_ERROR_TAIL
    : ENGINE_ERROR_TAIL
}

export function modelCodeForProfile(
  code: string,
  profile: PerformanceModelProfile = 'small'
) {
  return profile !== 'small' && !code.includes(largeModelImport)
    ? `${code.trimEnd()}\n\n${largeModelImport}\nperformanceModel\n`
    : code
}

export async function copyProfileModelFiles(
  fs: Fixtures['fs'],
  projectDirectory: string,
  profile: PerformanceModelProfile
) {
  if (profile === 'small') {
    return
  }
  const destination = await fs.join(projectDirectory, 'large-model')
  await fs.mkdir(destination, { recursive: true })
  for (const file of await readdir(largeModelSource)) {
    await fs.writeFile(
      await fs.join(destination, file),
      new Uint8Array(await readFile(path.join(largeModelSource, file)))
    )
  }
}

type ModelFixtures = {
  page: Page
  modelProfile?: PerformanceModelProfile
}

export async function appendProfileError({
  page,
  modelProfile,
}: ModelFixtures) {
  if (!isErrorProfile(modelProfile)) return
  const previous = await page.evaluate(() => {
    const editor = window.app.project?.executingEditor.value
    if (!editor) throw new Error('The error profile needs an executed model')
    return {
      code: editor.code,
      lastSuccessfulCode: editor.lastSuccessfulCode,
      artifactCount: editor.artifactGraph.size,
    }
  })
  const requestedCode = `${previous.code.trimEnd()}\n${errorTail(modelProfile)}`
  try {
    expect(previous.artifactCount).toBeGreaterThan(0)
    expect(previous.code).toBe(previous.lastSuccessfulCode)
    await page.locator('#code-pane .cm-content').fill(requestedCode)
    await page.waitForFunction((requestedCode) => {
      const editor = window.app.project?.executingEditor.value
      return Boolean(
        editor &&
          editor.code === requestedCode &&
          (editor.hasErrors() || editor.lastSuccessfulCode === requestedCode) &&
          !editor.isExecutingSignal.value &&
          Object.keys(editor.engineCommandManager.pendingCommands).length === 0
      )
    }, requestedCode)
    const receipt = await assertModelLoaded({ page, modelProfile })
    expect(receipt.code).toBe(requestedCode)
    expect(receipt.lastSuccessfulCode).toBe(previous.lastSuccessfulCode)
    if (modelProfile === 'large-syntax-error') {
      expect(receipt.artifactCount).toBe(previous.artifactCount)
    }
    return receipt
  } catch (error) {
    try {
      const actual = await page.evaluate(() => {
        const editor = window.app.project?.executingEditor.value
        if (!editor) return { editorMissing: true }
        return {
          code: editor.code,
          lastSuccessfulCode: editor.lastSuccessfulCode,
          hasErrors: editor.hasErrors(),
          hasParseErrors: editor.hasParseErrors(),
          diagnostics: editor.diagnostics.map(
            ({ severity, from, to, message }) => ({
              severity,
              from,
              to,
              message,
            })
          ),
          errors: editor.errors.map(({ kind, msg, sourceRange }) => ({
            kind,
            msg,
            sourceRange,
          })),
          isExecuting: editor.isExecutingSignal.value,
          hasEditsSinceLastExecution:
            editor.hasEditsSinceLastExecutionSignal.value,
          pendingCommandCount: Object.keys(
            editor.engineCommandManager.pendingCommands
          ).length,
        }
      })
      await test.info().attach('error-profile-preparation-failure', {
        body: JSON.stringify({ modelProfile, requestedCode, actual }, null, 2),
        contentType: 'application/json',
      })
    } catch (diagnosticError) {
      test.info().annotations.push({
        type: 'error-profile-diagnostics-unavailable',
        description: String(diagnosticError),
      })
    }
    throw error
  }
}

export async function assertModelLoaded(
  { page, modelProfile = 'small' }: ModelFixtures,
  { allowCodeErrors = false }: { allowCodeErrors?: boolean } = {}
) {
  const errorProfile = isErrorProfile(modelProfile)
  await page.waitForFunction(
    ({ allowCodeErrors, errorProfile }) => {
      const editor = window.app.project?.executingEditor.value
      return Boolean(
        editor &&
          !editor.isExecutingSignal.value &&
          (errorProfile ||
            editor.hasErrors() ||
            editor.artifactGraph.size > 0) &&
          Object.keys(editor.engineCommandManager.pendingCommands).length ===
            0 &&
          (allowCodeErrors ||
            editor.hasErrors() ||
            (!editor.hasEditsSinceLastExecutionSignal.value &&
              editor.lastSuccessfulCode === editor.code &&
              !editor.hasErrors()))
      )
    },
    { allowCodeErrors: allowCodeErrors || errorProfile, errorProfile },
    { timeout: 90_000 }
  )
  const evidence = await page.evaluate(() => {
    const editor = window.app.project?.executingEditor.value
    if (!editor) {
      throw new Error('The performance model has no executing editor')
    }
    const filenames = Object.values(editor.execState.filenames).flatMap(
      (module) =>
        module?.type === 'Local' ? [module.value.replaceAll('\\', '/')] : []
    )
    let mainArtifacts = 0
    let importedArtifacts = 0
    for (const artifact of editor.artifactGraph.values()) {
      if ('codeRef' in artifact && artifact.codeRef) {
        if (artifact.codeRef.range[2] === 0) {
          mainArtifacts++
        } else {
          importedArtifacts++
        }
      }
    }
    return {
      code: editor.code,
      lastSuccessfulCode: editor.lastSuccessfulCode,
      errors: editor.errors.map(({ kind, msg, sourceRange }) => ({
        kind,
        msg,
        sourceRange,
      })),
      hasErrors: editor.hasErrors(),
      hasParseErrors: editor.hasParseErrors(),
      diagnostics: editor.diagnostics.map(
        ({ severity, from, to, message }) => ({
          severity,
          from,
          to,
          message,
        })
      ),
      artifactCount: editor.artifactGraph.size,
      mainArtifacts,
      importedArtifacts,
      filenames,
      pendingCommandCount: Object.keys(
        editor.engineCommandManager.pendingCommands
      ).length,
      executionElapsedMs:
        editor.executingEditorService.executionElapsedMs.value,
      isExecuting: editor.isExecutingSignal.value,
      hasEditsSinceLastExecution: editor.hasEditsSinceLastExecutionSignal.value,
    }
  })
  expect(evidence.isExecuting).toBe(false)
  expect(evidence.pendingCommandCount).toBe(0)
  if (!errorProfile && !allowCodeErrors) {
    expect(
      evidence.errors,
      'The performance fixture must execute successfully'
    ).toEqual([])
    expect(
      evidence.diagnostics.filter(({ severity }) => severity === 'error'),
      'The performance fixture must parse and compile successfully'
    ).toEqual([])
  }
  expect(evidence.artifactCount).toBeGreaterThan(0)
  expect(evidence.lastSuccessfulCode.trim().length).toBeGreaterThan(0)
  if (isErrorProfile(modelProfile)) {
    // A large model alone is not this profile. The trailing error and the old
    // successful geometry must both survive every measured UI interaction.
    expect(
      evidence.hasErrors,
      'The expected error disappeared; this is no longer an error-model run'
    ).toBe(true)
    expect(evidence.code).toContain(errorTail(modelProfile))
    expect(evidence.lastSuccessfulCode).not.toContain('performanceInvalid = ')
    expect(evidence.lastSuccessfulCode).not.toBe(evidence.code)
    const statementStart = evidence.code.lastIndexOf('performanceInvalid = ')
    expect(statementStart).toBeGreaterThan(0)
    if (modelProfile === 'large-syntax-error') {
      expect(
        evidence.hasParseErrors,
        'The syntax profile must fail in the parser'
      ).toBe(true)
      expect(
        evidence.errors,
        'A runtime error cannot substitute for the expected syntax error'
      ).toEqual([])
      const errors = evidence.diagnostics.filter(
        ({ severity }) => severity === 'error'
      )
      expect(errors).not.toHaveLength(0)
      for (const diagnostic of errors) {
        expect(
          diagnostic.from,
          'Syntax error must originate in the trailing statement'
        ).toBeGreaterThanOrEqual(statementStart)
        expect(diagnostic.to).toBeLessThanOrEqual(evidence.code.length)
        expect(diagnostic.message).toContain('Unexpected end of file')
      }
    } else {
      expect(
        evidence.hasParseErrors,
        'A parser failure cannot substitute for an engine failure'
      ).toBe(false)
      expect(
        evidence.errors,
        'Expected exactly the deliberate kernel failure'
      ).toHaveLength(1)
      const byteStart = new TextEncoder().encode(
        evidence.code.slice(0, statementStart)
      ).length
      const byteLength = new TextEncoder().encode(evidence.code).length
      for (const error of evidence.errors) {
        expect(error.kind).toBe('engine')
        expect(error.msg).toContain(ENGINE_ERROR_MESSAGE)
        expect(error.sourceRange[2]).toBe(0)
        expect(
          error.sourceRange[0],
          'Engine failure must originate in the trailing fillet'
        ).toBeGreaterThanOrEqual(byteStart)
        expect(error.sourceRange[1]).toBeLessThanOrEqual(byteLength)
      }
    }
  } else if (!allowCodeErrors) {
    expect(evidence.errors).toEqual([])
    expect(evidence.hasErrors).toBe(false)
    expect(evidence.hasEditsSinceLastExecution).toBe(false)
    expect(evidence.lastSuccessfulCode).toBe(evidence.code)
  }
  if (modelProfile !== 'small') {
    expect(evidence.lastSuccessfulCode).toContain(largeModelImport)
    if (modelProfile !== 'large-engine-error') {
      // A failed cached append reports the current execution's module map, not
      // the imported modules retained from the preceding successful execution.
      // The setup receipt verifies those paths before injecting the error.
      expect(
        evidence.filenames.some((filename) =>
          filename.endsWith('large-model/main.kcl')
        )
      ).toBe(true)
    }
    // Compare real graph provenance: the imported workload must exceed the
    // retained small interaction model, not merely appear in the source text.
    expect(evidence.importedArtifacts).toBeGreaterThan(evidence.mainArtifacts)
  } else {
    expect(evidence.lastSuccessfulCode).not.toContain(largeModelImport)
  }
  return {
    profile: modelProfile,
    code: evidence.code,
    source:
      modelProfile !== 'small' ? largeModelSource : 'named_views_hide_extrude',
    artifactCount: evidence.artifactCount,
    mainArtifacts: evidence.mainArtifacts,
    importedArtifacts: evidence.importedArtifacts,
    filenames: evidence.filenames,
    executionElapsedMs: evidence.executionElapsedMs,
    pendingCommandCount: evidence.pendingCommandCount,
    allowCodeErrors,
    hasErrors: evidence.hasErrors,
    hasParseErrors: evidence.hasParseErrors,
    diagnosticCount: evidence.diagnostics.length,
    lastSuccessfulCode: evidence.lastSuccessfulCode,
    errorKinds: evidence.errors.map(({ kind }) => kind),
    errorMessages: evidence.errors.map(({ msg }) => msg),
  }
}

export async function assertErrorModelPreserved(
  fixtures: ModelFixtures,
  before: Awaited<ReturnType<typeof assertModelLoaded>>
) {
  if (!isErrorProfile(fixtures.modelProfile)) return
  const after = await assertModelLoaded(fixtures)
  expect(after.code).toBe(before.code)
  expect(after.lastSuccessfulCode).toBe(before.lastSuccessfulCode)
  expect(after.artifactCount).toBe(before.artifactCount)
}
