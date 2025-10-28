import * as packageJSON from '@root/package.json'
import os from 'node:os'

export const isMac = os.platform() === 'darwin'
// Temporarily stolen from src/routes/utils.ts#L48-L49
// TODO: remove when we migrate to the new copilot
export const isStagingOrDebug =
  packageJSON.name.indexOf('-staging') > -1 || packageJSON.version === '0.0.0'
