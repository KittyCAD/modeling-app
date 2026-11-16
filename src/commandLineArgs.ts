import minimist from 'minimist'
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'

export const argvFromYargs = yargs(hideBin(process.argv))
  .option('app-config', {
    type: 'string',
    description: 'Read the app extension composition from a TOML manifest.',
  })
  .option('telemetry', {
    alias: 't',
    type: 'boolean',
    description: 'Writes startup telemetry to file on disk.',
  })
  .parse()

// TODO: find a better way to merge minimist and yargs parsers.

export function parseCLIArgs(argv: string[]): minimist.ParsedArgs {
  return minimist(argv, {
    // Preserve boolean handling of existing flags, while allowing --app-config
    // to consume its value instead of treating the TOML path as a project.
    boolean: argv.flatMap((arg) => {
      if (!arg.startsWith('--')) return []
      const name = arg.slice(2).split('=')[0]
      return name === 'app-config' ? [] : [name]
    }),
    string: ['app-config'],
  })
}

export function getPathOrUrlFromArgs(
  args: minimist.ParsedArgs
): string | undefined {
  if (args._.length > 1) {
    return args._[1]
  }
  return undefined
}
