import { RuleTester } from 'eslint'
import { afterAll, describe, it } from 'vitest'
import rule from './interaction-expectations.mjs'

RuleTester.afterAll = afterAll
RuleTester.describe = describe
RuleTester.it = it

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
})

const importDefinitions =
  "import { interactions } from '@src/lib/interactionPerformance/definitions'"
const metadata = `
  data-interaction-id={interactions.commandPaletteOpen.id}
  data-testid={interactions.commandPaletteOpen.testId}
  data-expect-interaction-ms={interactions.commandPaletteOpen.budgetMs}
`
const definitionsFile = '/repo/src/lib/interactionPerformance/definitions.ts'

ruleTester.run('interaction-expectations', rule, {
  valid: [
    // Existing controls are deliberately outside this opt-in rule.
    'const control = <button onClick={open} data-testid="legacy" />',
    `${importDefinitions}; const control = <button ${metadata} />`,
    `${importDefinitions}; const control = <button {...props} ${metadata} />`,
    `
      import { interactions as timings } from '@src/lib/interactionPerformance/definitions'
      const control = <button
        data-interaction-id={timings.commandPaletteClose.id}
        data-testid={timings.commandPaletteClose.testId}
        data-expect-interaction-ms={timings.commandPaletteClose.budgetMs}
      />
    `,
    {
      filename: definitionsFile,
      code: 'export const interactions = { open: { budgetMs: 150 }, close: { budgetMs: 100 } }',
    },
    {
      filename: definitionsFile,
      code: "export const interactions = { open: { ...defaults, 'budgetMs': 150 } }",
    },
    // Unrelated numeric budgets have their own contracts.
    'const interactions = { remoteOperation: { budgetMs: 500 } }',
  ],
  invalid: [
    {
      code: 'const control = <button data-interaction-id="zds.commandPalette.open" />',
      errors: [{ messageId: 'definition' }],
    },
    {
      code: `${importDefinitions}; const control = <button data-expect-interaction-ms={interactions.commandPaletteOpen.budgetMs} />`,
      errors: [{ messageId: 'definition' }],
    },
    {
      code: `${importDefinitions}; const control = <button data-interaction-id={interactions.commandPaletteOpen.id} />`,
      errors: [
        {
          messageId: 'metadata',
          data: { field: 'testId', attribute: 'data-testid' },
        },
        {
          messageId: 'metadata',
          data: { field: 'budgetMs', attribute: 'data-expect-interaction-ms' },
        },
      ],
    },
    {
      code: `
        ${importDefinitions}
        const control = <button
          data-interaction-id={interactions.commandPaletteOpen.id}
          data-testid={interactions.commandPaletteClose.testId}
          data-expect-interaction-ms={150}
        />
      `,
      errors: [
        {
          messageId: 'metadata',
          data: { field: 'testId', attribute: 'data-testid' },
        },
        {
          messageId: 'metadata',
          data: { field: 'budgetMs', attribute: 'data-expect-interaction-ms' },
        },
      ],
    },
    {
      code: `${importDefinitions}; const control = <button ${metadata} {...props} />`,
      errors: [{ messageId: 'override' }],
    },
    {
      code: `${importDefinitions}; function Button(interactions) { return <button ${metadata} /> }`,
      errors: [{ messageId: 'definition' }],
    },
    {
      code: `import { interactions } from './unregistered'; const control = <button ${metadata} />`,
      errors: [{ messageId: 'definition' }],
    },
    ...['0', '-1', '151', 'Infinity', 'budgetFromSettings'].map((budget) => ({
      filename: definitionsFile,
      code: `export const interactions = { open: { budgetMs: ${budget} } }`,
      errors: [{ messageId: 'budget' }],
    })),
    {
      filename: definitionsFile,
      code: 'export const interactions = { open: {} }',
      errors: [{ messageId: 'budget' }],
    },
    {
      filename: definitionsFile,
      code: 'const override = { budgetMs: 300 }; export const interactions = { open: { budgetMs: 150, ...override } }',
      errors: [{ messageId: 'budgetOverride' }],
    },
  ],
})
