import { readFileSync } from 'fs'

const data = readFileSync('./test-results/report.json', 'utf8')

// We need this until Playwright's JSON reporter supports `stripANSIControlSequences`
// https://github.com/microsoft/playwright/issues/33670#issuecomment-2487941649
const ansiRegex = new RegExp('([\\u001B\\u009B][[\\]()#;?]*(?:(?:(?:[a-zA-Z\\d]*(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]*)*)?\\u0007)|(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-ntqry=><~])))', 'g');
export function stripAnsiEscapes(str) {
  return str ? str.replace(ansiRegex, '') : '';
}

// types, but was easier to store and run as normal js
// interface FailedTest {
//     name: string;
//     projectName: string;
//     error: string;
// }

// interface Spec {
//     title: string;
//     tests: Test[];
// }

// interface Test {
//     expectedStatus: 'passed' | 'failed' | 'pending';
//     projectName: string;
//     title: string;
//     results: {
//         status: 'passed' | 'failed' | 'pending';
//         error: {stack: string}
//     }[]
// }

// interface Suite {
//     title: string
//     suites: Suite[];
//     specs: Spec[];
// }

// const processReport = (suites: Suite[]): FailedTest[] => {
//     const failedTests: FailedTest[] = []
//     const loopSuites = (suites: Suite[], previousName = '') => {
const processReport = (suites) => {
  const failedTests = []
  const loopSuites = (suites, previousName = '') => {
    if (!suites) return
    for (const suite of suites) {
      const name = (previousName ? `${previousName} -- ` : '') + suite.title
      for (const spec of suite.specs) {
        for (const test of spec.tests) {
          for (const result of test.results) {
            if ((result.status !== 'passed') && test.expectedStatus === 'passed') {
              failedTests.push({
                name: (name + ' -- ' + spec.title) + (test.title ? ` -- ${test.title}` : ''),
                status: result.status,
                projectName: test.projectName,
                error: stripAnsiEscapes(result.error?.stack),
              })
            }
          }
        }
      }
      loopSuites(suite.suites, name)
    }
  }
  loopSuites(suites)
  return failedTests.map(line => JSON.stringify(line)).join('\n')
}
const failedTests = processReport(JSON.parse(data).suites)
// log to stdout to be piped to axiom
console.log(failedTests)

