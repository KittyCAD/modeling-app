// Match the lint command's TypeScript compatibility setup before loading its parser.
import '../../../scripts/register-typescript-eslint-typescript.cjs'
import { RuleTester } from 'eslint'
import tsParser from '@typescript-eslint/parser'
import { afterAll, describe, it } from 'vitest'
import rule from './no-react-router-hooks.mjs'

RuleTester.afterAll = afterAll
RuleTester.describe = describe
RuleTester.it = it

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tsParser,
    ecmaVersion: 2022,
    sourceType: 'module',
  },
})

ruleTester.run('no-react-router-hooks', rule, {
  valid: [
    `import { Link, Outlet, createBrowserRouter } from 'react-router-dom'`,
    `import type { Location, NavigateFunction } from 'react-router-dom'`,
    `export { Link as AppLink } from 'react-router-dom'`,
    `import { useState } from 'react'`,
    `import { useLocation } from '@src/lib/applicationState'`,
    `const url = new URL('https://api.zoo.dev'); function useEndpoint() { return url }`,
    `const useLocalState = () => {}; export { useLocalState }`,
  ],
  invalid: [
    ...[
      'useLocation',
      'useNavigate',
      'useSearchParams',
      'useRouteError',
      'useFutureHook',
    ].map((name) => ({
      code: `import { ${name} } from 'react-router-dom'`,
      errors: [{ messageId: 'routerHook', data: { name } }],
    })),
    {
      code: `import { useLocation as readState, Link } from 'react-router-dom'`,
      errors: [{ messageId: 'routerHook', data: { name: 'useLocation' } }],
    },
    {
      code: `import { useLocation, useNavigate } from 'react-router-dom'`,
      errors: [
        { messageId: 'routerHook', data: { name: 'useLocation' } },
        { messageId: 'routerHook', data: { name: 'useNavigate' } },
      ],
    },
    {
      code: `import type { useLocation } from 'react-router-dom'`,
      errors: [{ messageId: 'routerHook', data: { name: 'useLocation' } }],
    },
    {
      code: `export { useNavigate as changeState } from 'react-router-dom'`,
      errors: [{ messageId: 'routerHook', data: { name: 'useNavigate' } }],
    },
    ...[
      `import * as router from 'react-router-dom'`,
      `import type * as Router from 'react-router-dom'`,
      `import router from 'react-router-dom'`,
      `export * from 'react-router-dom'`,
      `export * as router from 'react-router-dom'`,
      `const router = await import('react-router-dom')`,
    ].map((code) => ({
      code,
      errors: [{ messageId: 'opaqueRouterImport' }],
    })),
  ],
})
