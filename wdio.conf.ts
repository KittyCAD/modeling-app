import os from 'os'
import path from 'path'
import { spawn, ChildProcess } from 'child_process'

let tauriDriver: ChildProcess

const application =
  process.env.E2E_APPLICATION || `./src-tauri/target/release/zoo-modeling-app`

export const config = {
  hostname: '127.0.0.1',
  port: 4444,
  specs: ['./e2e/tauri/specs/**/*.ts'],
  maxInstances: 1,
  capabilities: [
    {
      maxInstances: 1,
      'tauri:options': {
        application,
        webviewOptions: {}, // Windows only
      },
    },
  ],
  reporters: ['spec'],
  framework: 'mocha',
  mochaOpts: {
    bail: true,
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
