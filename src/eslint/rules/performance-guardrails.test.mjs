import '../../../scripts/register-typescript-eslint-typescript.cjs'
import { ESLint, RuleTester } from 'eslint'
import { afterAll, describe, expect, it } from 'vitest'
import cssParser from '../css-parser.mjs'
import noArtificialDelay from './no-artificial-delay.mjs'
import noLongUiAnimation from './no-long-ui-animation.mjs'
import performanceExceptions from './performance-exceptions.mjs'
import createPerformanceDirectivesProcessor from '../performance-directives.mjs'

RuleTester.afterAll = afterAll
RuleTester.describe = describe
RuleTester.it = it

const tester = new RuleTester({
  linterOptions: { reportUnusedDisableDirectives: false },
  plugins: { zds: { rules: { 'no-long-ui-animation': noLongUiAnimation } } },
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
})

tester.run('no-artificial-delay', noArtificialDelay, {
  valid: [
    'requestAnimationFrame(render); video.requestVideoFrameCallback(presented)',
    '// zds-performance-exception: network-deadline -- Reject a stalled external request without postponing its start.\nsetTimeout(reject, deadline)',
    '// zds-performance-exception: input-protocol -- Expire an unfinished multi-key chord, not its input feedback.\nconst state = { after: { 1500: "idle" } }',
    'function delayDescription() { return "no delay" } delayDescription()',
  ],
  invalid: [
    ...[
      'setTimeout(show, 0)',
      'window.setTimeout(show, unknown)',
      'globalThis["setInterval"](render, duration)',
      'sleep(50)',
      'delay(duration)',
      'wait()',
      'debounce(update, 20)',
      'throttle(update, dynamicDelay)',
      'deferredCallback(update, 1)',
      'AbortSignal.timeout(dynamicDeadline)',
      'import { debounce as defer } from "helpers"; defer(update, 5)',
      'import defer from "lodash/debounce"; defer(update, 5)',
      'import { setTimeout as pause } from "node:timers/promises"; pause(5)',
      'const later = window.setTimeout; later(show, 100)',
      'const { setTimeout: later } = window; later(show, 100)',
      'const state = { after: { finishedWaiting: "ready" } }',
      'const control = <Tooltip delay={dynamic} />',
      '// zds-performance-exception: arbitrary -- This is not a supported functional category.\nsetTimeout(show, 1)',
      '// zds-performance-exception: network-deadline -- too short\nsetTimeout(show, 1)',
      '// zds-performance-exception: network-deadline -- The exception is not adjacent to this call.\nconst other = 1\nsetTimeout(show, 1)',
      '// zds-performance-exception: network-deadline -- Only the first adjacent deadline has been classified at this site.\nsetTimeout(reject, deadline); setTimeout(show, 500)',
    ].map((code) => ({ code, errors: [{ messageId: 'delay' }] })),
  ],
})

tester.run('no-long-ui-animation', noLongUiAnimation, {
  valid: [
    'const style = { transitionDuration: "100ms", transitionDelay: "0s" }',
    'const style = { animation: "appear 50ms 2", animationDelay: "0ms" }',
    'const duration = "0.1s"; const style = { animationDuration: duration }',
    'const control = <div className="hover:transition-colors duration-100 delay-0" />',
    'const control = <div className="animate-[appear_100ms_ease-out]" />',
    'element.animate(frames, { duration: 50, iterations: 2, delay: 0 })',
    'scene.animate()',
    'const toast = { duration: 1500 }',
    'import { Toaster } from "react-hot-toast"; import { AppToast } from "@src/components/AppToast"; const notifications = <Toaster containerClassName="app-toaster">{toast => <AppToast toast={toast} />}</Toaster>',
    'import * as notifications from "react-hot-toast"; import { AppToast as Notification } from "@src/components/AppToast"; const view = <notifications.Toaster containerClassName="app-toaster">{toast => <Notification toast={toast} />}</notifications.Toaster>',
    'const actor = { src: "animate-to-face", outcome: "the transition ended" }',
    '// zds-performance-exception: activity-indicator -- A continuously rotating spinner communicates pending network work.\nconst spinner = <div className="animate-spin" />',
  ],
  invalid: [
    ...[
      'const style = { transitionDuration: "101ms" }',
      'tooltip.style.transition = "opacity 0.2s"',
      'tooltip.style.setProperty("transition-duration", "200ms")',
      'const style = { animationDuration: "0.2s" }',
      'const style = { transitionDelay: "1ms" }',
      'const style = { animation: "appear 50ms 1ms" }',
      'const style = { animation: "appear 60ms 2" }',
      'const style = { animation: "appear 200ms 0" }',
      'const style = { animation: "inherit" }',
      'const style = { animation: "spin 50ms infinite" }',
      'const style = { animationDuration: "60ms", animationIterationCount: 2 }',
      'const style = { animationDuration: "60ms", animationIterationCount: unknown }',
      'const style = { animationDuration: duration }',
      'const style = { transitionDuration: "var(--duration)" }',
      'const style = { transitionDuration: "100ms, 200ms" }',
      'const control = <div className="duration-150" />',
      'const control = <div className="hover:delay-[0.01s]" />',
      'const control = <div className="duration-[var(--timing)]" />',
      'const control = <div className="transition-colors" />',
      'const control = <div className="animate-[appear_50ms_3]" />',
      'const control = <div className="[transition:opacity_200ms]" />',
      'const control = <div className={`duration-${unknown}`} />',
      'const control = <Transition enterTimeout={200} />',
      'element.animate(frames, unknown)',
      'element.animate(frames, { duration: 101 })',
      'element.animate(frames, { duration: 60, iterations: 2 })',
      'element.animate(frames, { duration: 200, iterations: 0 })',
      'element.animate(frames, { duration: 100, delay: dynamicDelay })',
      'element.animate(frames, { duration: 50, iterations: unknown })',
      '// zds-performance-exception: activity-indicator -- A spinner is functional but it may not postpone its first feedback.\nconst style = { animationDelay: "1ms" }',
      '// zds-performance-exception: activity-indicator -- Even a functional spinner must declare its actual known timing.\nconst style = { animationDuration: unknown }',
      '// zds-performance-exception: activity-indicator -- Even a functional spinner must declare its actual known timing.\nelement.animate(frames, options)',
      '// zds-performance-exception: activity-indicator -- Even a functional spinner must declare its actual known timing.\nconst spinner = <Transition animationDuration={unknown} />',
      '// zds-performance-exception: activity-indicator -- Even a functional spinner must declare its actual known timing.\nconst spinner = <div className="duration-[var(--timing)]" />',
      '// zds-performance-exception: activity-indicator -- A spinner is functional but it may not postpone its first feedback.\nconst spinner = <div className="[animation:spin_1s_1ms_infinite]" />',
      '// zds-performance-exception: network-deadline -- A network timeout does not justify a decorative animation.\nconst spinner = <div className="animate-spin" />',
    ].map((code) => ({ code, errors: [{ messageId: 'timing' }] })),
    ...[
      'import { Toaster } from "react-hot-toast"; const view = <Toaster />',
      'import { Toaster as Alerts } from "react-hot-toast"; const view = <Alerts containerClassName="app-toaster" />',
      'import { ToastBar } from "react-hot-toast"; const view = <ToastBar toast={toast} />',
      'import { ToastIcon as Icon } from "react-hot-toast"; const view = <Icon toast={toast} />',
      'import { Toaster } from "react-hot-toast"; import { AppToast } from "@src/components/AppToast"; const Alias = Toaster; const view = <Alias>{toast => <AppToast toast={toast} />}</Alias>',
    ].map((code) => ({ code, errors: [{ messageId: 'toastDefaults' }] })),
  ],
})

tester.run('performance-exceptions', performanceExceptions, {
  valid: [
    '// zds-performance-exception: connection-retry -- Retry a failed transport connection after releasing its resources.\nsetTimeout(reconnect, backoff)',
    '// eslint-disable-next-line no-console -- An unrelated scoped exemption.\nconst foo = 1',
  ],
  invalid: [
    ...[
      '// zds-performance-exception: unknown -- Even a long reason cannot make an unknown category legitimate.\nconst foo = 1',
      '// zds-performance-exception: activity-indicator -- vague\nconst foo = 1',
    ].map((code) => ({ code, errors: [{ messageId: 'invalid' }] })),
  ],
})

const cssLint = new ESLint({
  overrideConfigFile: true,
  overrideConfig: [
    {
      files: ['**/*.css'],
      languageOptions: { parser: cssParser },
      plugins: {
        zds: {
          rules: {
            'no-long-ui-animation': noLongUiAnimation,
            'performance-exceptions': performanceExceptions,
          },
        },
      },
      rules: {
        'zds/no-long-ui-animation': 'error',
        'zds/performance-exceptions': 'error',
      },
    },
  ],
})

const directiveLint = new ESLint({
  overrideConfigFile: true,
  overrideConfig: [
    {
      files: ['**/*.js'],
      processor: createPerformanceDirectivesProcessor(),
      linterOptions: { reportUnusedDisableDirectives: false },
      plugins: {
        zds: {
          rules: {
            'no-artificial-delay': noArtificialDelay,
            'no-long-ui-animation': noLongUiAnimation,
            'performance-exceptions': performanceExceptions,
          },
        },
      },
      rules: {
        'no-console': 'error',
        'zds/no-artificial-delay': 'error',
        'zds/no-long-ui-animation': 'error',
        'zds/performance-exceptions': 'error',
      },
    },
  ],
})

describe('native ESLint inline-suppression boundary', () => {
  it.each([
    '/* eslint-disable */\nsetTimeout(show, 500)',
    '/* eslint-disable zds/performance-exceptions, zds/no-artificial-delay */\nsetTimeout(show, 500)',
    '/* eslint zds/performance-exceptions: "off", zds/no-artificial-delay: "off" */\nsetTimeout(show, 500)',
    '// eslint-disable-next-line zds/no-artificial-delay\nsetTimeout(show, 500)',
  ])('cannot suppress guardrails: %s', async (code) => {
    const [result] = await directiveLint.lintText(code, {
      filePath: 'src/policy.js',
    })
    expect(result.messages).toContainEqual(
      expect.objectContaining({
        ruleId: 'zds/performance-exceptions',
        severity: 2,
        fatal: true,
      })
    )
  })

  it('preserves unrelated scoped inline suppression', async () => {
    const [result] = await directiveLint.lintText(
      '// eslint-disable-next-line no-console -- This is an unrelated logging exception.\nconsole.log("diagnostic")',
      { filePath: 'src/policy.js' }
    )
    expect(result.messages).toEqual([])
  })

  it('releases prior diagnostics before the same file is linted again', async () => {
    await directiveLint.lintText(
      '/* eslint-disable */\nsetTimeout(show, 500)',
      { filePath: 'src/reused.js' }
    )
    const [result] = await directiveLint.lintText('const ready = true', {
      filePath: 'src/reused.js',
    })
    expect(result.messages).toEqual([])
  })

  it('protects actual repository CSS even from a blanket inline disable', async () => {
    const [result] = await new ESLint().lintText(
      '/* eslint-disable */\n.panel { transition: opacity 200ms; }',
      { filePath: 'src/App.css' }
    )
    expect(result.messages).toContainEqual(
      expect.objectContaining({
        ruleId: 'zds/performance-exceptions',
        severity: 2,
        fatal: true,
      })
    )
  })
})

describe('CSS performance policy through ESLint and PostCSS', () => {
  it.each([
    '.panel { transition: opacity 100ms; transition-delay: 0s }',
    '.panel { animation: appear 50ms 2; }',
    '.panel { @apply transition-opacity duration-75; }',
    '.spinner { /* zds-performance-exception: activity-indicator -- Keep pending network activity visible without delaying completion. */\nanimation: spin 1s linear infinite; }',
  ])('accepts valid CSS: %s', async (code) => {
    const [result] = await cssLint.lintText(code, {
      filePath: 'src/policy.css',
    })
    expect(result.messages).toEqual([])
  })

  it.each([
    '.panel { transition: opacity 101ms; }',
    '.panel { transition-delay: 1ms; }',
    '.panel { animation: appear 50ms 3; }',
    '.panel { animation-duration: 60ms; animation-iteration-count: 2; }',
    '.panel { animation-duration: var(--duration); }',
    '.panel { @apply transition-opacity; }',
    '.panel { @apply duration-200; }',
  ])('rejects invalid CSS: %s', async (code) => {
    const [result] = await cssLint.lintText(code, {
      filePath: 'src/policy.css',
    })
    expect(result.messages).toEqual([
      expect.objectContaining({ ruleId: 'zds/no-long-ui-animation' }),
    ])
  })

  it('reports invalid CSS syntax instead of silently skipping the file', async () => {
    const [result] = await cssLint.lintText('.panel {', {
      filePath: 'src/policy.css',
    })
    expect(result.fatalErrorCount).toBe(1)
  })

  it('uses the actual repository CSS configuration', async () => {
    const [result] = await new ESLint().lintText(
      '.panel { transition: opacity 200ms; }',
      { filePath: 'src/App.css' }
    )
    expect(result.messages).toEqual([
      expect.objectContaining({
        ruleId: 'zds/no-long-ui-animation',
        severity: 2,
      }),
    ])
  })
})
