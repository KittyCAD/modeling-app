import {
  Program,
  BinaryExpression,
  BinaryPart,
  Literal,
  CallExpression,
  Value,
  FunctionExpression,
  ArrayExpression,
  ObjectExpression,
  MemberExpression,
  PipeExpression,
  UnaryExpression,
  BodyItem,
  VariableDeclarator,
  ObjectProperty,
} from './abstractSyntaxTreeTypes'
import { precedence } from './astMathExpressions'

import { recast_js } from '../wasm-lib/pkg/wasm_lib'

function transformProgram(program: Program): { [key: string]: any } {
  const transformedProgram: { [key: string]: any } = {
    ...program,
  }

  if (transformedProgram.body) {
    transformedProgram.body = transformedProgram.body.map(
      (bodyItem: BodyItem) => {
        const transformedBodyItem: { [key: string]: any } = {
          ...bodyItem,
        }

        if (
          transformedBodyItem.type === 'ExpressionStatement' &&
          transformedBodyItem.expression
        ) {
          transformedBodyItem.expression = transformValue(
            transformedBodyItem.expression
          )
        }

        if (
          transformedBodyItem.type === 'VariableDeclaration' &&
          transformedBodyItem.declarations
        ) {
          transformedBodyItem.declarations =
            transformedBodyItem.declarations.map(
              (declarator: VariableDeclarator) => {
                const transformedDeclarator: { [key: string]: any } = {
                  ...declarator,
                }

                transformedDeclarator.init = transformValue(
                  transformedDeclarator.init
                )

                return transformedDeclarator
              }
            )
        }

        if (
          transformedBodyItem.type === 'ReturnStatement' &&
          transformedBodyItem.argument
        ) {
          transformedBodyItem.argument = transformValue(
            transformedBodyItem.argument
          )
        }
        delete transformedBodyItem.type
        delete transformedProgram.type

        return {
          [bodyItem.type]: transformedBodyItem,
        }
      }
    )
  }
  const { start, ...rest } = transformedProgram.nonCodeMeta
  if (start) {
    delete start.type
  }
  Object.entries(rest).forEach(([key, value]: [string, any]) => {
    delete value.type
  })
  const nonCodeMeta = {
    start,
    noneCodeNodes: rest,
  }
  transformedProgram.nonCodeMeta = nonCodeMeta
  return transformedProgram
}

function transformValue(value: Value): { [key: string]: any } {
  const transformedValue: { [key: string]: any } = {
    ...value,
  }

  if (transformedValue.type === 'CallExpression' && transformedValue.callee) {
    transformedValue.arguments = transformedValue.arguments.map(
      (argument: Value) => transformValue(argument)
    )
  }

  if (transformedValue.type === 'MemberExpression' && transformedValue.object) {
    transformedValue.object = transformValue(transformedValue.object)
  }

  if (
    transformedValue.type === 'MemberExpression' &&
    transformedValue.property
  ) {
    transformedValue.property = transformValue(transformedValue.property)
  }

  if (
    transformedValue.type === 'ArrayExpression' &&
    transformedValue.elements
  ) {
    transformedValue.elements = transformedValue.elements.map(
      (element: Value) => transformValue(element)
    )
  }
  if (
    transformedValue.type === 'UnaryExpression' &&
    transformedValue.argument
  ) {
    transformedValue.argument = transformValue(transformedValue.argument)
  }
  if (transformedValue.type === 'BinaryExpression' && transformedValue.left) {
    transformedValue.left = transformValue(transformedValue.left)
    transformedValue.right = transformValue(transformedValue.right)
  }

  if (
    transformedValue.type === 'ObjectExpression' &&
    transformedValue.properties
  ) {
    transformedValue.properties = transformedValue.properties.map(
      (property: ObjectProperty) => {
        const transformedProperty: { [key: string]: any } = {
          ...property,
        }

        if (transformedProperty.value) {
          transformedProperty.value = transformValue(transformedProperty.value)
        }

        return transformedProperty
      }
    )
  }
  if (
    transformedValue.type === 'FunctionExpression' &&
    transformedValue.body &&
    transformedValue.body.body
  ) {
    transformedValue.body = transformProgram(transformedValue.body)
  }

  if (
    transformedValue.type === 'ReturnStatement' &&
    transformedValue.argument
  ) {
    transformedValue.argument = transformValue(transformedValue.argument)
  }

  if (transformedValue.type === 'PipeExpression' && transformedValue.body) {
    transformedValue.body = transformedValue.body.map((body: any) =>
      transformValue(body)
    )
    const { start, ...rest } = transformedValue.nonCodeMeta
    if (start) {
      delete start.type
    }
    transformedValue.nonCodeMeta = {
      start,
      noneCodeNodes: rest,
    }
  }

  delete transformedValue.type

  return {
    [value.type]: transformedValue,
  }
}

export function recast(
  ast: Program,
  previousWrittenCode = '',
  indentation = '',
  isWithBlock = false
): string {
  const transformed = transformProgram(ast)
  const toSend = JSON.stringify(transformed, null, 2)
  return recast_js(toSend)
}
