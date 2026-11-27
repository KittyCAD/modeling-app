import {
  clearCommandLogs,
  closeDebugPanel,
  expectCmdLog,
  openAndClearDebugPanel,
  openDebugPanel,
  sendCustomCmd,
  waitForCmdReceive,
} from '@e2e/playwright/lib/debugSupport'
import type { Page } from '@playwright/test'
import type { EngineCommand } from '@src/lang/std/artifactGraph'
export class DebugFixture {
  constructor(private readonly page: Page) {}
  sendCommand = (cmd: EngineCommand) => sendCustomCmd(this.page, cmd)

  clearCommandLogs = () => clearCommandLogs(this.page)

  expectCommandLog = (locatorStr: string, timeout = 5000) =>
    expectCmdLog(this.page, locatorStr, timeout)

  open = () => openDebugPanel(this.page)

  close = () => closeDebugPanel(this.page)

  openAndClear = () => openAndClearDebugPanel(this.page)

  clearAndClose = async () => {
    await clearCommandLogs(this.page)
    return closeDebugPanel(this.page)
  }

  waitForCommandReceived = (commandType: string) =>
    waitForCmdReceive(this.page, commandType)
}
