import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'

const argv = yargs(hideBin(process.argv))
  .option('telemetry', {
    alias: 't',
    type: 'boolean',
    description: 'Writes startup telemetry to file on disk.',
  })
  .parse()

export default argv
