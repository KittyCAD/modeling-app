import minimist from 'minimist'
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'

export const argvFromYargs = yargs(hideBin(process.argv))
  .option('telemetry', {
    alias: 't',
    type: 'boolean',
    description: 'Writes startup telemetry to file on disk.',
  })
  .parse()

// TODO: find a better way to merge minimist and yargs parsers.

export function parseCLIArgs(argv: string[]): minimist.ParsedArgs {
  return minimist(argv, {
    // Treat all double-hyphenated arguments without equal signs as boolean
    boolean: true,
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
