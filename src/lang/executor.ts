import { Program, BinaryPart } from "./abstractSyntaxTree";

export const executor = (ast: Program, rootOverride: {[key: string]: any} = {}): any => {
  const programMemory: { [key: string]: any } = {
    root: {
      ...rootOverride
    },
  };
  const { body } = ast;
  body.forEach((statement) => {
    if (statement.type === "VariableDeclaration") {
      statement.declarations.forEach((declaration) => {
        const variableName = declaration.id.name;
        if (declaration.init.type === "Literal") {
          programMemory.root[variableName] = declaration.init.value;
        } else if (declaration.init.type === "BinaryExpression") {
          const getVal = (part: BinaryPart) => {
            if (part.type === "Literal") {
              return part.value;
            } else if (part.type === "Identifier") {
              return programMemory.root[part.name];
            }
          };
          const left = getVal(declaration.init.left);
          const right = getVal(declaration.init.right);
          programMemory.root[variableName] = left + right;
        }
      });
    } else if (statement.type === "ExpressionStatement") {
      const expression = statement.expression;
      if (expression.type === "CallExpression") {
        const functionName = expression.callee.name;
        const args = expression.arguments.map((arg) => {
          if (arg.type === "Literal") {
            return arg.value;
          } else if (arg.type === "Identifier") {
            return programMemory.root[arg.name];
          }
        });
        programMemory.root[functionName](...args);
      }
    }
  });
  return programMemory;
};
