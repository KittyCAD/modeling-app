import type { StepSchema as ApiStepSchema } from '@rust/kcl-lib/bindings/ModelingCmd'

export enum StepSchema {
  Ap203 = 'ap203',
  Ap214 = 'ap214',
  Ap242 = 'ap242',
}

// Keep the runtime enum and its labels exhaustive over the generated API type.
export const STEP_SCHEMA_LABELS = {
  [StepSchema.Ap203]: 'AP203 (Edition 2)',
  [StepSchema.Ap214]: 'AP214',
  [StepSchema.Ap242]: 'AP242',
} satisfies Record<ApiStepSchema, string>
