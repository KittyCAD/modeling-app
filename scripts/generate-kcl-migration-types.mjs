import { readFile, writeFile } from 'node:fs/promises'
import openapiTS, { astToString } from 'openapi-typescript'

// Generate only the public migration contract until the API SDK publishes it.
// Usage: node --import ./scripts/register-typescript-compat.mjs scripts/generate-kcl-migration-types.mjs ../api/openapi/api.json
const source = JSON.parse(await readFile(process.argv[2], 'utf8'))
const schemas = {}
function include(name) {
  if (schemas[name]) return
  schemas[name] = source.components.schemas[name]
  for (const match of JSON.stringify(schemas[name]).matchAll(
    /#\/components\/schemas\/([^"\s]+)/g
  )) {
    include(match[1])
  }
}
include('KclMigrationClientMessage')
include('KclMigrationServerMessage')
const ast = await openapiTS({
  openapi: source.openapi,
  info: source.info,
  paths: {},
  components: { schemas },
})
await writeFile(
  'src/lib/kclMigration/api.generated.ts',
  '// Generated from KittyCAD/api#4696. Do not edit by hand.\n' + astToString(ast)
)
