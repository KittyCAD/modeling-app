import { _electron as electron, test, expect } from '@playwright/test'
import fs from 'fs/promises'
import { getUtils } from './test-utils'

test.setTimeout(10000000)

test('homepage has title', async () => {
  const app = await electron.launch({
    args: ['.', '--no-sandbox', '--disable-setuid-sandbox'],
  })
  const page = await app.firstWindow()
  await page.waitForTimeout(100000)
})
