const os = require('os')
const path = require('path')
const { spawn } = require('child_process')

// keep track of the `tauri-driver` child process
let tauriDriver

const application =
  process.env.E2E_APPLICATION || './src-tauri/target/release/kittycad-modeling'

exports.config = {
  port: 4444,
  specs: ['./e2e/tauri/specs/**/*.js'],
  maxInstances: 1,
  capabilities: [
    {
      maxInstances: 1,
      'tauri:options': {
        application,
      },
    },
  ],
  reporters: ['spec'],
  framework: 'mocha',
  mochaOpts: {
    ui: 'bdd',
    timeout: 600000,
  },

  // ensure we are running `tauri-driver` before the session starts so that we can proxy the webdriver requests
  beforeSession: () =>
    (tauriDriver = spawn(
      path.resolve(os.homedir(), '.cargo', 'bin', 'tauri-driver'),
      [],
      { stdio: [null, process.stdout, process.stderr] }
    )),

  // clean up the `tauri-driver` process we spawned at the start of the session
  afterSession: () => tauriDriver.kill(),
}
