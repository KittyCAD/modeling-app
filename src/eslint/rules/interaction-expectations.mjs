const DEFINITIONS_MODULE = '@src/lib/interactionPerformance/definitions'
const DEFINITIONS_FILE = '/src/lib/interactionPerformance/definitions.ts'
const METADATA = new Map([
  ['data-interaction-id', 'id'],
  ['data-testid', 'testId'],
  ['data-expect-interaction-ms', 'budgetMs'],
])

function findBinding(context, identifier) {
  let scope = context.sourceCode.getScope(identifier)
  while (scope) {
    const binding = scope.set.get(identifier.name)
    if (binding) return binding
    scope = scope.upper
  }
  return undefined
}

function registeredReference(context, definition) {
  if (
    definition.type !== 'MemberExpression' ||
    definition.computed ||
    definition.object.type !== 'Identifier' ||
    definition.property.type !== 'Identifier'
  ) {
    return undefined
  }

  const imported = findBinding(context, definition.object)?.defs[0]
  return imported?.type === 'ImportBinding' &&
    imported.node.type === 'ImportSpecifier' &&
    imported.node.imported.name === 'interactions' &&
    imported.parent.source.value === DEFINITIONS_MODULE
    ? definition.property.name
    : undefined
}

function interactionChoice(context, expression) {
  if (registeredReference(context, expression)) {
    return { tracked: true, nullable: false }
  }
  if (
    expression.type === 'Identifier' &&
    expression.name === 'undefined' &&
    !findBinding(context, expression)?.defs.length
  ) {
    return { tracked: false, nullable: true }
  }
  if (expression.type === 'ConditionalExpression') {
    const consequent = interactionChoice(context, expression.consequent)
    const alternate = interactionChoice(context, expression.alternate)
    if (consequent && alternate) {
      return {
        tracked: consequent.tracked || alternate.tracked,
        nullable: consequent.nullable || alternate.nullable,
      }
    }
  }
  return undefined
}

function definitionReference(context, attribute, field) {
  const value = attribute?.value
  if (value?.type !== 'JSXExpressionContainer') return undefined
  const fallback =
    value.expression.type === 'LogicalExpression' &&
    value.expression.operator === '??'
  const expression = fallback ? value.expression.left : value.expression
  const member =
    expression.type === 'ChainExpression' ? expression.expression : expression
  if (
    member.type !== 'MemberExpression' ||
    member.computed ||
    member.property.type !== 'Identifier' ||
    member.property.name !== field ||
    (fallback && field !== 'testId')
  ) {
    return undefined
  }
  const registered = registeredReference(context, member.object)
  if (registered) return fallback ? undefined : registered
  if (member.object.type !== 'Identifier') return undefined

  const binding = findBinding(context, member.object)
  const declaration = binding?.defs[0]
  if (
    declaration?.type !== 'Variable' ||
    declaration.parent.kind !== 'const' ||
    declaration.node.id.type !== 'Identifier' ||
    !declaration.node.init ||
    binding.references.some(
      (reference) => reference.isWrite() && !reference.init
    )
  ) {
    return undefined
  }
  const choice = interactionChoice(context, declaration.node.init)
  if (
    !choice?.tracked ||
    (choice.nullable && !member.optional) ||
    (fallback && !choice.nullable)
  ) {
    return undefined
  }
  // Binding identity prevents fields from different conditional choices mixing.
  return binding
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
        'Use a central interaction definition or an immutable conditional alias for data-interaction-id.',
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
