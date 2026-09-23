const DEFINITIONS_MODULE = '@src/lib/interactionPerformance/definitions'
const DEFINITIONS_FILE = '/src/lib/interactionPerformance/definitions.ts'
const METADATA = new Map([
  ['data-interaction-id', 'id'],
  ['data-testid', 'testId'],
  ['data-expect-interaction-ms', 'budgetMs'],
])

function definitionReference(context, attribute, field) {
  const value = attribute?.value
  if (value?.type !== 'JSXExpressionContainer') return undefined
  const member = value.expression
  if (
    member.type !== 'MemberExpression' ||
    member.computed ||
    member.property.type !== 'Identifier' ||
    member.property.name !== field
  ) {
    return undefined
  }
  const definition = member.object
  if (
    definition.type !== 'MemberExpression' ||
    definition.computed ||
    definition.object.type !== 'Identifier' ||
    definition.property.type !== 'Identifier'
  ) {
    return undefined
  }

  let scope = context.sourceCode.getScope(definition.object)
  while (scope) {
    const binding = scope.set.get(definition.object.name)
    if (binding) {
      const imported = binding.defs[0]
      return imported?.type === 'ImportBinding' &&
        imported.node.type === 'ImportSpecifier' &&
        imported.node.imported.name === 'interactions' &&
        imported.parent.source.value === DEFINITIONS_MODULE
        ? definition.property.name
        : undefined
    }
    scope = scope.upper
  }
  return undefined
}

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require opted-in interaction controls to share a registered identity, test ID, and latency expectation.',
    },
    messages: {
      definition:
        'Use interactions.<name>.id from the central interaction definitions for data-interaction-id.',
      metadata:
        'Use {{field}} from the same registered interaction for {{attribute}}.',
      override:
        'Place spread props before interaction metadata so they cannot override its identity or expectation.',
      budget:
        'Registered interaction budgets must be literal numbers greater than 0 and no more than 150 ms.',
      budgetOverride:
        'Place spreads before budgetMs so the registered expectation cannot be overridden.',
    },
    schema: [],
  },
  create(context) {
    return {
      JSXOpeningElement(node) {
        const attributes = node.attributes.filter(
          (attribute) =>
            attribute.type === 'JSXAttribute' &&
            METADATA.has(attribute.name.name)
        )
        if (
          !attributes.some(
            (attribute) =>
              attribute.name.name === 'data-interaction-id' ||
              attribute.name.name === 'data-expect-interaction-ms'
          )
        ) {
          return
        }

        const identity = attributes.find(
          (attribute) => attribute.name.name === 'data-interaction-id'
        )
        const definition = definitionReference(context, identity, 'id')
        if (!definition) {
          context.report({ node: identity ?? node, messageId: 'definition' })
          return
        }

        for (const [name, field] of METADATA) {
          const matches = attributes.filter(
            (attribute) => attribute.name.name === name
          )
          if (
            matches.length !== 1 ||
            definitionReference(context, matches[0], field) !== definition
          ) {
            context.report({
              node: matches[0] ?? node,
              messageId: 'metadata',
              data: { field, attribute: name },
            })
          }
        }
        for (const attribute of node.attributes) {
          if (
            attribute.type === 'JSXSpreadAttribute' &&
            attribute.range[0] > attributes[0].range[0]
          ) {
            context.report({ node: attribute, messageId: 'override' })
          }
        }
      },
      ObjectExpression(node) {
        if (!context.filename.replaceAll('\\', '/').endsWith(DEFINITIONS_FILE))
          return
        const property = node.parent
        if (property.type !== 'Property') return
        const definitions = property.parent
        const declaration =
          definitions.parent.type === 'TSSatisfiesExpression'
            ? definitions.parent.parent
            : definitions.parent
        if (
          declaration.type !== 'VariableDeclarator' ||
          declaration.id.type !== 'Identifier' ||
          declaration.id.name !== 'interactions'
        ) {
          return
        }
        const budgetIndex = node.properties.findIndex(
          (property) =>
            property.type === 'Property' &&
            !property.computed &&
            ((property.key.type === 'Identifier' &&
              property.key.name === 'budgetMs') ||
              (property.key.type === 'Literal' &&
                property.key.value === 'budgetMs'))
        )
        const budget = node.properties[budgetIndex]
        if (
          budget?.value.type !== 'Literal' ||
          typeof budget.value.value !== 'number' ||
          budget.value.value <= 0 ||
          budget.value.value > 150
        ) {
          context.report({ node: budget ?? node, messageId: 'budget' })
          return
        }
        const override = node.properties
          .slice(budgetIndex + 1)
          .find((property) => property.type === 'SpreadElement')
        if (override) {
          context.report({ node: override, messageId: 'budgetOverride' })
        }
      },
    }
  },
}

export default rule
