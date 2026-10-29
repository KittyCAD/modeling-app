import {
  delayBudgetScenarios,
  unsupportedDelayBudgetScenarios,
} from '@e2e/performance/delay-budget-scenarios'
import { modelingBudgetScenarios } from '@e2e/performance/modeling-budget-scenarios'
import { uiBudgetScenarios } from '@e2e/performance/ui-budget-scenarios'
import { expectAbsoluteInteractionBudget } from '@e2e/performance/absolute-budget'
import {
  finishCapture,
  startCapture,
  waitForSample,
} from '@e2e/performance/capture'
import { test } from '@e2e/performance/test'
import type { InteractionReport } from '@src/lib/interactionPerformance/report'
import {
  assertErrorModelPreserved,
  assertModelLoaded,
  isErrorProfile,
  ERROR_MODEL_PROFILES,
  MODEL_PROFILES,
} from '@e2e/performance/models'
import type { PerformanceModelProfile } from '@e2e/performance/models'
import type { BudgetScenario } from '@e2e/performance/budget-scenarios'

const scenarios = [
  ...modelingBudgetScenarios,
  ...uiBudgetScenarios,
  ...delayBudgetScenarios,
]

function profilesFor(scenario: BudgetScenario) {
  const profiles: readonly (PerformanceModelProfile | undefined)[] =
    scenario.context === 'home'
      ? [undefined]
      : MODEL_PROFILES.filter(
          (profile) =>
            !isErrorProfile(profile) || !scenario.unavailableWithErrors
        )
  return profiles
}

test.beforeAll(async ({}, testInfo) => {
  await testInfo.attach('audited-interaction-coverage', {
    body: JSON.stringify(
      {
        measured: scenarios.flatMap((scenario) =>
          profilesFor(scenario).map((modelProfile) => ({
            ...scenario.definition,
            context: scenario.context ?? 'modeling',
            modelProfile,
            startsEmpty: scenario.startsEmpty ?? false,
            allowCodeErrors: scenario.allowCodeErrors ?? false,
          }))
        ),
        unsupported: [
          ...unsupportedDelayBudgetScenarios,
          ...scenarios.flatMap((scenario) =>
            scenario.unavailableWithErrors
              ? ERROR_MODEL_PROFILES.map((profile) => ({
                  definition: scenario.definition,
                  modelProfile: profile,
                  reason: scenario.unavailableWithErrors,
                }))
              : []
          ),
        ],
      },
      null,
      2
    ),
    contentType: 'application/json',
  })
})

// Each case owns a fresh renderer. A red budget assertion must not prevent the
// remaining audited interactions from collecting their own raw evidence.
for (const scenario of scenarios) {
  for (const profile of profilesFor(scenario)) {
    test.describe(profile ? `modeling-${profile}` : 'home', () => {
      test.use({ modelProfile: profile ?? 'small' })
      test(
        scenario.definition.id,
        { tag: scenario.tags ? [...scenario.tags] : [] },
        async (
          {
            page,
            homePage,
            scene,
            fs,
            folderSetupFn,
            toolbar,
            editor,
            cmdBar,
            copilot,
            modelingDialog,
            nativeMenu,
            signInPage,
            tronApp,
            modelProfile,
          },
          testInfo
        ) => {
          if (scenario.definition.timeoutMs !== undefined) {
            test.setTimeout(120_000 + scenario.definition.timeoutMs)
          }
          if (!tronApp) {
            throw new Error('Interaction budget scenarios require Electron')
          }
          const fixtures = {
            page,
            homePage,
            scene,
            fs,
            folderSetupFn,
            toolbar,
            editor,
            cmdBar,
            copilot,
            modelingDialog,
            nativeMenu,
            signInPage,
            modelProfile,
            tronApp,
          }
          await scenario.prepare(fixtures)
          const before =
            profile && !scenario.startsEmpty
              ? await assertModelLoaded(fixtures, {
                  allowCodeErrors: scenario.allowCodeErrors ?? false,
                })
              : undefined
          await startCapture(page, [scenario.definition.id])
          let report: InteractionReport
          try {
            await scenario.act(fixtures)
            await waitForSample(
              page,
              scenario.definition.id,
              1,
              scenario.definition.timeoutMs === undefined
                ? undefined
                : scenario.definition.timeoutMs + 5_000
            )
            await scenario.verify?.(fixtures)
            if (before) await assertErrorModelPreserved(fixtures, before)
          } finally {
            report = await finishCapture(
              page,
              testInfo,
              `budget.${profile ?? 'home'}.${scenario.definition.id}`,
              { [scenario.definition.id]: 1 },
              tronApp,
              undefined,
              profile
            )
          }
          await expectAbsoluteInteractionBudget(report, profile, testInfo)
        }
      )
    })
  }
}
