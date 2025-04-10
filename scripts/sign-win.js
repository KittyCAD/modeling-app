// From https://github.com/OpenBuilds/OpenBuilds-CONTROL/blob/4800540ffaa517925fc2cff26670809efa341ffe/signWin.js
const { execSync } = require('node:child_process')

exports.default = async (configuration) => {
  if (!process.env.SM_API_KEY) {
    console.error(
      'Signing using signWin.js script: failed: SM_API_KEY ENV VAR NOT FOUND'
    )
    return
  }

  if (!process.env.WINDOWS_CERTIFICATE_THUMBPRINT) {
    console.error(
      'Signing using signWin.js script: failed: FINGERPRINT ENV VAR NOT FOUND'
    )
    return
  }

  if (!configuration.path) {
    throw new Error(
      `Signing using signWin.js script: failed: TARGET PATH NOT FOUND`
    )
  }

  try {
    execSync(
      `smctl sign --fingerprint="${process.env.WINDOWS_CERTIFICATE_THUMBPRINT
      }" --input "${String(configuration.path)}"`,
      {
        stdio: 'pipe',
      }
    )
    console.log('Signing using signWin.js script: successful')
  } catch (error) {
    throw new Error('Signing using signWin.js script: failed:', error)
  }
}
