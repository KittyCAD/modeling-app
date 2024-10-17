import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'

const argv = yargs(hideBin(process.argv))
  .option('telemetry', {
    alias: 't',
    type: 'boolean',
    description: 'Run with local telemetry logs to disk',
  })
  .parse()

export default argv
