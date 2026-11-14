import {
  extrudeCommandConfig,
  loftCommandConfig,
} from '@src/lib/commandBarConfigs/profileCommandConfig'
import { modelingCommandCodemods } from '@src/lib/commandBarConfigs/modelingCommandCodemods'
import type {
  ExtrudeCommandArgs,
  LoftCommandArgs,
} from '@src/lib/commandBarConfigs/modelingCommandStdLibTypes'
import type { Command, CommandArgumentConfig } from '@src/lib/commandTypes'
import type { KclModelingCodemod } from '@src/lib/kcl/modelingEdit'
import { isKclVersionAvailable } from '@src/lib/kclVersionRange'
import { parse, resultIsOk } from '@src/lang/wasm'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { isErr } from '@src/lib/trap'

/** These proofs share the legacy stdlib schema and transform; collection and execution belong to their view. */
export interface StdlibTool<Args extends object> {
  id: string
  name: string
  icon: Command['icon']
  arguments: { [Key in keyof Args]: CommandArgumentConfig<Args[Key], unknown> }
  codemod: KclModelingCodemod<Args>
}
export const extrudeTool: StdlibTool<ExtrudeCommandArgs> = {
  id: 'kcl.extrude',
  name: 'Extrude',
  icon: 'extrude',
  arguments: extrudeCommandConfig.args,
  codemod: modelingCommandCodemods.Extrude,
}
export const loftTool: StdlibTool<LoftCommandArgs> = {
  id: 'kcl.loft',
  name: 'Loft',
  icon: 'loft',
  arguments: loftCommandConfig.args,
  codemod: modelingCommandCodemods.Loft,
}
export function toolCommand<Args extends object>(
  tool: StdlibTool<Args>,
  contents: string,
  wasm: ModuleType,
  experimental: boolean
): Command | Error {
  const parsed = parse(contents, wasm)
  if (isErr(parsed)) return parsed
  if (!resultIsOk(parsed))
    return new Error('Fix the KCL syntax before opening a tool.')
  const args: NonNullable<Command['args']> = {}
  for (const [name, config] of Object.entries(tool.arguments) as [
    string,
    CommandArgumentConfig<unknown, unknown>,
  ][]) {
    if (!config) continue
    const {
      available: _legacyAvailability,
      availableInKclVersion,
      ...arg
    } = config
    if (
      availableInKclVersion &&
      !isKclVersionAvailable(parsed.kclVersion, availableInKclVersion, wasm)
    )
      continue
    if (arg.status === 'experimental' && !experimental) continue
    args[name] = arg
  }
  return {
    id: tool.id,
    name: tool.name,
    icon: tool.icon,
    groupId: 'kcl.modeling',
    scopes: ['mode-modeling'],
    needsReview: true,
    args,
    onSubmit: () =>
      new Error('Use the owning Modeling view dialog to submit this command.'),
  }
}
