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
const conditionalInteraction = `
  const interaction = pane.id === 'code'
    ? (isActiveIndex ? interactions.codePaneClose : interactions.codePaneOpen)
    : pane.id === 'files'
      ? (isActiveIndex ? interactions.filesPaneClose : interactions.filesPaneOpen)
      : undefined
`
const optionalMetadata = `
  data-interaction-id={interaction?.id}
  data-testid={interaction?.testId ?? \`\${pane.id}-pane-button\`}
  data-expect-interaction-ms={interaction?.budgetMs}
`
const definitionsFile = '/repo/src/lib/interactionPerformance/definitions.ts'

ruleTester.run('interaction-expectations', rule, {
  valid: [
    // Existing controls are deliberately outside this opt-in rule.
    'const control = <button onClick={open} data-testid="legacy" />',
    `${importDefinitions}; const control = <button ${metadata} />`,
    `${importDefinitions}; const control = <button {...props} ${metadata} />`,
    `${importDefinitions}; function PaneButton({ pane, isActiveIndex }) { ${conditionalInteraction}; return <button ${optionalMetadata} /> }`,
    `
      ${importDefinitions}
      const interaction = isOpen ? interactions.commandPaletteClose : interactions.commandPaletteOpen
      const control = <button
        data-interaction-id={interaction.id}
        data-testid={interaction.testId}
        data-expect-interaction-ms={interaction.budgetMs}
      />
    `,
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
    ...[
      'let interaction = isOpen ? interactions.commandPaletteClose : undefined',
      'var interaction = interactions.commandPaletteOpen',
      'const interaction = selectInteraction(interactions.commandPaletteOpen)',
      'const interaction = isOpen ? interactions.commandPaletteClose : customDefinition',
      'const interaction = undefined',
      'const interaction = interactions.commandPaletteOpen; interaction = interactions.commandPaletteClose',
    ].map((declaration) => ({
      code: `${importDefinitions}; ${declaration}; const control = <button ${optionalMetadata} />`,
      errors: [{ messageId: 'definition' }],
    })),
    {
      code: `
        ${importDefinitions}
        const { id: interaction } = interactions.commandPaletteOpen
        const control = <button
          data-interaction-id={interaction.id}
          data-testid={interaction.testId}
          data-expect-interaction-ms={interaction.budgetMs}
        />
      `,
      errors: [{ messageId: 'definition' }],
    },
    {
      code: `${importDefinitions}; function Button(undefined) { ${conditionalInteraction}; return <button ${optionalMetadata} /> }`,
      errors: [{ messageId: 'definition' }],
    },
    {
      code: `
        ${importDefinitions}
        ${conditionalInteraction}
        const other = isOpen ? interactions.codePaneClose : interactions.codePaneOpen
        const control = <button
          data-interaction-id={interaction?.id}
          data-testid={other.testId}
          data-expect-interaction-ms={other.budgetMs}
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
      code: `
        ${importDefinitions}
        ${conditionalInteraction}
        const control = <button
          data-interaction-id={interaction?.id}
          data-testid={interaction?.id ?? 'legacy'}
          data-expect-interaction-ms={interaction?.budgetMs ?? 150}
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
    ...['interaction.id', "interaction?.id ?? 'legacy'"].map((identity) => ({
      code: `
        ${importDefinitions}
        ${conditionalInteraction}
        const control = <button
          data-interaction-id={${identity}}
          data-testid={interaction?.testId}
          data-expect-interaction-ms={interaction?.budgetMs}
        />
      `,
      errors: [{ messageId: 'definition' }],
    })),
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
