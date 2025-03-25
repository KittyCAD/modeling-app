import { orRunWhenFullSuiteEnabled } from './test-utils'

const originalEnv = { ...process.env }

afterAll(() => {
  process.env = { ...originalEnv }
})

describe('utility to bypass unreliable tests', () => {
  it('always runs them on dedicated branch', () => {
    process.env.GITHUB_EVENT_NAME = 'push'
    process.env.GITHUB_REF = 'refs/heads/all-e2e'
    process.env.GITHUB_HEAD_REF = ''
    process.env.GITHUB_BASE_REF = ''
    const condition = orRunWhenFullSuiteEnabled()
    expect(condition).toBe(false)
  })
  it('skips them on the main branch', () => {
    process.env.GITHUB_EVENT_NAME = 'push'
    process.env.GITHUB_REF = 'refs/heads/main'
    process.env.GITHUB_HEAD_REF = ''
    process.env.GITHUB_BASE_REF = ''
    const condition = orRunWhenFullSuiteEnabled()
    expect(condition).toBe(true)
  })
  it('skips them on pull requests', () => {
    process.env.GITHUB_EVENT_NAME = 'pull_request'
    process.env.GITHUB_REF = 'refs/pull/5883/merge'
    process.env.GITHUB_HEAD_REF = 'my-branch'
    process.env.GITHUB_BASE_REF = 'main'
    const condition = orRunWhenFullSuiteEnabled()
    expect(condition).toBe(true)
  })
})
