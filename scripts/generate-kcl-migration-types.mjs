import { readFile, writeFile } from 'node:fs/promises'
import openapiTS, { astToString } from 'openapi-typescript'
import ts from 'typescript'

// Generate only the public migration contract until the API SDK publishes it.
// Usage: node --import ./scripts/register-typescript-compat.mjs scripts/generate-kcl-migration-types.mjs ../api/openapi/api.json
const source = JSON.parse(await readFile(process.argv[2], 'utf8'))
const schemas = {}
function include(name) {
  if (schemas[name]) return
  if (name === 'MlCopilotServerMessage') {
    // Display messages already ship in the SDK; do not generate a second copy.
    schemas[name] = { type: 'object' }
    return
  }
  schemas[name] = source.components.schemas[name]
  for (const match of JSON.stringify(schemas[name]).matchAll(
    /#\/components\/schemas\/([^"\s]+)/g
  )) {
    include(match[1])
  }
}
include('KclMigrationClientMessage')
include('KclMigrationServerMessage')
const ast = await openapiTS(
  {
    openapi: source.openapi,
    info: source.info,
    paths: {},
    components: { schemas },
  },
  {
    defaultNonNullable: false,
    inject: "import type { MlCopilotServerMessage } from '@kittycad/lib'",
    transform(_schema, { path }) {
      if (path === '#/components/schemas/MlCopilotServerMessage') {
        return ts.factory.createTypeReferenceNode('MlCopilotServerMessage')
      }
    },
  }
)
await writeFile(
  'src/lib/kclMigration/api.generated.ts',
  '// Generated from KittyCAD/api#4805. Do not edit by hand.\n' +
    astToString(ast)
)
