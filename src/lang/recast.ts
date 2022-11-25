import { Program, BinaryExpression, BinaryPart } from "./abstractSyntaxTree";

export function recast(ast: Program, previousWrittenCode = ''): string {
  return ast.body
    .map((statement) => {
        if(statement.type === "ExpressionStatement") {
            if(statement.expression.type === "BinaryExpression") {
                return recastBinaryExpression(statement.expression);
            }
        }
      return statement.type;
    })
    .join("\n");
}

function recastBinaryExpression(expression: BinaryExpression): string {
    return `${recastBinaryPart(expression.left)} ${expression.operator} ${recastBinaryPart(expression.right)}`
}

function recastBinaryPart(part: BinaryPart): string {
    if(part.type === "Literal") {
        return String(part?.value);
    } else if(part.type === "Identifier") {
        return part.name;
    }
    throw new Error(`Cannot recast ${part}`);
}
