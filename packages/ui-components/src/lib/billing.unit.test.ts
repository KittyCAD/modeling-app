import {
  type CustomerBalance,
  type PaymentMethod,
  type UserOrgInfo,
  type ZooProductSubscriptions,
  Client,
} from '@kittycad/lib'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { BillingError, getBillingInfo } from '@kittycad/ui-components'
import { afterAll, afterEach, beforeAll, expect, test } from 'vitest'

const client = new Client({ token: 'does-not-matter' })

const server = setupServer()
beforeAll(() => server.listen())
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

function createUserPaymentBalanceResponse(opts: {
  monthlyApiBalanceRemainingMonthlyValue: number
  stableApiBalanceRemainingMonthlyValue: number
}): CustomerBalance {
  return {
    created_at: '2025-05-05T16:05:47.317Z',
    monthly_api_credits_remaining: 0,
    monthly_api_credits_remaining_monetary_value:
      opts.monthlyApiBalanceRemainingMonthlyValue,
    stable_api_credits_remaining: 0,
    stable_api_credits_remaining_monetary_value:
      opts.stableApiBalanceRemainingMonthlyValue,
    subscription_details: undefined,
    subscription_id: 'Hnd3jalJkHA3lb1YexOTStZtPYHTM',
    total_due: 100.08,
    updated_at: '2025-05-05T16:05:47.317Z',
  }
}

function createUserOrgResponse(): UserOrgInfo {
  return {
    id: '78432284-8660-46bf-ac65-d00bf9b18c3e',
    created_at: '2024-01-26T23:14:28.062Z',
    updated_at: '2025-11-10T20:09:09.190Z',
    name: 'Zoo',
    billing_email: 'billing@zoo.dev',
    image: 'https://avatars.githubusercontent.com/u/81783542?s=200&v=4',
    domain: 'zoo.dev',
    allow_users_in_domain_to_auto_join: true,
    phone: '',
    stripe_id: 'stripe_id',
    role: 'member',
  }
}

function createUserPaymentMethodsResponse(): PaymentMethod[] {
  return [
    {
      billing_info: {
        name: 'Zoo User',
      },
      created_at: '2026-01-02T21:57:20.048Z',
      id: 'pm_123',
      metadata: {},
      type: 'card',
    },
  ]
}

function createUserPaymentSubscriptionsResponse(opts: {
  monthlyPayAsYouGoApiBalanceTotalMonthlyValue: number
  name: string
}): ZooProductSubscriptions {
  return {
    modeling_app: {
      annual_discount: 10,
      description: 'Modeling app subscription',
      monthly_pay_as_you_go_api_credits: 0,
      monthly_pay_as_you_go_api_credits_monetary_value:
        opts.monthlyPayAsYouGoApiBalanceTotalMonthlyValue,
      name: opts.name,
      pay_as_you_go_api_credit_price: 0.0083,
      price: {
        interval: 'year',
        price: 50.04,
        type: 'per_user',
      },
      support_tier: 'community',
      training_data_behavior: 'default_on',
      type: {
        saml_sso: true,
        type: 'organization',
      },
    },
  }
}

test('Handles error fetching billing on balance', async () => {
  server.use(
    http.get('*/user/payment/balance', () => {
      return new HttpResponse(null, { status: 403 })
    })
  )

  const billing = await getBillingInfo(client)
  expect(billing).toBeInstanceOf(BillingError)
})

test('Requests total due in user payment balance', async () => {
  let includeTotalDue: string | null = null

  server.use(
    http.get('*/user/payment/balance', ({ request }) => {
      includeTotalDue = new URL(request.url).searchParams.get(
        'include_total_due'
      )

      return HttpResponse.json(
        createUserPaymentBalanceResponse({
          monthlyApiBalanceRemainingMonthlyValue: 10,
          stableApiBalanceRemainingMonthlyValue: 0,
        })
      )
    }),
    http.get('*/user/payment/methods', () => {
      return HttpResponse.json(createUserPaymentMethodsResponse())
    }),
    http.get('*/user/payment/subscriptions', () => {
      return HttpResponse.json(
        createUserPaymentSubscriptionsResponse({
          monthlyPayAsYouGoApiBalanceTotalMonthlyValue: 10,
          name: 'free',
        })
      )
    }),
    http.get('*/user/org', () => {
      return new HttpResponse(null, { status: 403 })
    })
  )

  const billing = await getBillingInfo(client)
  if (BillingError.from(billing)) throw billing
  expect(includeTotalDue).toBe('true')
  expect(billing.userPaymentBalance?.total_due).toEqual(100.08)
})

test('Finds the credits of Free subscription', async () => {
  server.use(
    http.get('*/user/payment/balance', () => {
      return HttpResponse.json(
        createUserPaymentBalanceResponse({
          monthlyApiBalanceRemainingMonthlyValue: 10,
          stableApiBalanceRemainingMonthlyValue: 0,
        })
      )
    }),
    http.get('*/user/payment/methods', () => {
      return HttpResponse.json(createUserPaymentMethodsResponse())
    }),
    http.get('*/user/payment/subscriptions', () => {
      return HttpResponse.json(
        createUserPaymentSubscriptionsResponse({
          monthlyPayAsYouGoApiBalanceTotalMonthlyValue: 10,
          name: 'free',
        })
      )
    }),
    http.get('*/user/org', () => {
      return new HttpResponse(null, { status: 403 })
    })
  )

  const billing = await getBillingInfo(client)
  if (BillingError.from(billing)) throw billing
  expect(Math.floor(billing.balance)).toEqual(20)
  expect(Math.floor(billing.allowance!)).toEqual(20)
  expect(billing.hasSubscription).toBe(false)
  expect(billing.isOrg).toBe(false)
})

test('Finds the credits of Plus subscription', async () => {
  server.use(
    http.get('*/user/payment/balance', () => {
      return HttpResponse.json(
        createUserPaymentBalanceResponse({
          monthlyApiBalanceRemainingMonthlyValue: 50,
          stableApiBalanceRemainingMonthlyValue: 0,
        })
      )
    }),
    http.get('*/user/payment/methods', () => {
      return HttpResponse.json(createUserPaymentMethodsResponse())
    }),
    http.get('*/user/payment/subscriptions', () => {
      return HttpResponse.json(
        createUserPaymentSubscriptionsResponse({
          monthlyPayAsYouGoApiBalanceTotalMonthlyValue: 50,
          name: 'plus',
        })
      )
    }),
    http.get('*/user/org', () => {
      return new HttpResponse(null, { status: 403 })
    })
  )

  const billing = await getBillingInfo(client)
  if (BillingError.from(billing)) throw billing
  expect(Math.floor(billing.balance)).toEqual(100)
  expect(Math.floor(billing.allowance!)).toEqual(100)
  expect(billing.hasSubscription).toBe(true)
  expect(billing.isOrg).toBe(false)
})

test('Finds infinite credits for Pro subscription', async () => {
  server.use(
    http.get('*/user/payment/balance', () => {
      return HttpResponse.json(
        createUserPaymentBalanceResponse({
          monthlyApiBalanceRemainingMonthlyValue: 10,
          stableApiBalanceRemainingMonthlyValue: 0,
        })
      )
    }),
    http.get('*/user/payment/methods', () => {
      return HttpResponse.json(createUserPaymentMethodsResponse())
    }),
    http.get('*/user/payment/subscriptions', () => {
      return HttpResponse.json(
        createUserPaymentSubscriptionsResponse({
          monthlyPayAsYouGoApiBalanceTotalMonthlyValue: 20,
          name: 'pro',
        })
      )
    }),
    http.get('*/user/org', () => {
      return new HttpResponse(null, { status: 403 })
    })
  )

  const billing = await getBillingInfo(client)
  if (BillingError.from(billing)) throw billing
  expect(billing.balance).toBe(Number.POSITIVE_INFINITY)
  expect(billing.allowance).toBeUndefined()
  expect(billing.hasSubscription).toBe(true)
  expect(billing.isOrg).toBe(false)
})

test('Finds infinite credits for org user without payment method', async () => {
  server.use(
    http.get('*/user/payment/balance', () => {
      return HttpResponse.json(
        createUserPaymentBalanceResponse({
          monthlyApiBalanceRemainingMonthlyValue: 10,
          stableApiBalanceRemainingMonthlyValue: 0,
        })
      )
    }),
    http.get('*/user/payment/methods', () => {
      return HttpResponse.json(
        {
          error_code: 'ObjectNotFound',
          message: 'not found: stripe-customer',
        },
        { status: 404 }
      )
    }),
    http.get('*/user/payment/subscriptions', () => {
      return HttpResponse.json(
        createUserPaymentSubscriptionsResponse({
          monthlyPayAsYouGoApiBalanceTotalMonthlyValue: 20,
          name: 'enterprise',
        })
      )
    }),
    http.get('*/user/org', () => {
      return HttpResponse.json(createUserOrgResponse())
    })
  )

  const billing = await getBillingInfo(client)
  if (BillingError.from(billing)) throw billing
  expect(billing.balance).toBe(Number.POSITIVE_INFINITY)
  expect(billing.allowance).toBeUndefined()
  expect(billing.hasSubscription).toBe(true)
  expect(billing.paymentMethods).toEqual([])
  expect(billing.isOrg).toBe(true)
})
