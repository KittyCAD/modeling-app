import type { Page } from '@playwright/test'
import type {
  ElectronZoo,
  Fixtures,
} from '@e2e/playwright/fixtures/fixtureSetup'
import type { InteractionDescription } from '@src/lib/interactionPerformance/types'
import type { PerformanceModelProfile } from '@e2e/performance/models'

export type BudgetFixtures = Fixtures & {
  page: Page
  modelProfile: PerformanceModelProfile
  tronApp: ElectronZoo
}

export interface BudgetScenario {
  definition: InteractionDescription
  /** Modeling is the default, so future cases inherit both model sizes. */
  context?: 'home' | 'modeling'
  /** Geometry-creation measurements intentionally start from an empty scene. */
  startsEmpty?: boolean
  /** Diagnostic UI can retain a successfully rendered model after a code error. */
  allowCodeErrors?: boolean
  /** Some actions inherently require or create valid KCL rather than preserve errors. */
  unavailableWithErrors?: string
  tags?: readonly string[]
  prepare: (fixtures: BudgetFixtures) => Promise<void>
  act: (fixtures: BudgetFixtures) => Promise<void>
  verify?: (fixtures: BudgetFixtures) => Promise<void>
}
