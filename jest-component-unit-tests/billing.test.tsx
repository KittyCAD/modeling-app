
// Test runner
import {expect, test, beforeAll, afterEach, afterAll} from '@jest/globals';

// Render mocking, DOM querying
import {act, render, within} from '@testing-library/react'
import '@testing-library/jest-dom' // Required for .toHaveStyle

// Request mocking
import {http, HttpResponse} from 'msw'
import {setupServer} from 'msw/node'

// React and XState code to test
import { createActor } from 'xstate'
import {
  BillingRemaining,
  BillingRemainingMode,
} from '@src/components/BillingRemaining'
import { BillingDialog, } from '@src/components/BillingDialog'
import { billingMachine, BillingTransition } from '@src/machines/billingMachine'

// Setup basic request mocking
const server = setupServer()
beforeAll(() => server.listen())
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

// Data ripped from docs.zoo.dev
const createUserPaymentBalanceResponse = (opts: {
  monthlyApiCreditsRemaining,
  stableApiCreditsRemaining,
}) => ({
  "created_at": "2025-05-05T16:05:47.317Z",
  "id": "de607b7e-90ba-4977-8561-16e8a9ea0e50",
  "map_id": "d7f7de34-9bc3-4b8b-9951-cdee03fc792d",
  "modeling_app_enterprise_price": {
    "type": "enterprise"
  },
  "monthly_api_credits_remaining": opts.monthlyApiCreditsRemaining,
  "monthly_api_credits_remaining_monetary_value": "22.47",
  "stable_api_credits_remaining": opts.stableApiCreditsRemaining,
  "stable_api_credits_remaining_monetary_value": "18.91",
  "subscription_details": undefined,
  "subscription_id": "Hnd3jalJkHA3lb1YexOTStZtPYHTM",
  "total_due": "100.08",
  "updated_at": "2025-05-05T16:05:47.317Z"
})

const createOrgResponse = (opts: {
}) => ({
  "allow_users_in_domain_to_auto_join": true,
  "billing_email": "m@dN9MCH.com",
  "billing_email_verified": "2025-05-05T18:52:02.021Z",
  "block": "payment_method_failed",
  "can_train_on_data": true,
  "created_at": "2025-05-05T18:52:02.021Z",
  "domain": "Ctxde1hpG8xTvvlef5SEPm7",
  "id": "78432284-8660-46bf-ac65-d00bf9b18c3e",
  "image": "https://Rt0.yK.com/R2SoRtl/tpUdckyDJ",
  "name": "AevRR4w42KdkA487dh",
  "phone": "+1-696-641-2790",
  "stripe_id": "sCfjVscpLyOBYUWO7Vlx",
  "updated_at": "2025-05-05T18:52:02.021Z"
})

const createUserPaymentSubscriptionsResponse = (opts: {
  monthlyPayAsYouGoApiCreditsTotal,
  name,
}) => ({
  "modeling_app": {
    "annual_discount": 10,
    "description": "1ztERftrU3L3yOnv5epTLcM",
    "endpoints_included": [
      "modeling"
    ],
    "features": [
      {
        "info": "zZcZKHejXabT5HMZDkSkDGD2bfzkAt"
      }
    ],
    "monthly_pay_as_you_go_api_credits": opts.monthlyPayAsYouGoApiCreditsTotal,
    "monthly_pay_as_you_go_api_credits_monetary_value": "55.85",
    "name": opts.name,
    "pay_as_you_go_api_credit_price": "18.49",
    "price": {
      "interval": "year",
      "price": "50.04",
      "type": "per_user"
    },
    "share_links": [
      "password_protected"
    ],
    "support_tier": "community",
    "training_data_behavior": "default_on",
    "type": {
      "saml_sso": true,
      "type": "organization"
    },
    "zoo_tools_included": [
      "text_to_cad"
    ]
  }
})

test('Shows a loading spinner when unknown credit count or unexpected API data', async () => {
  server.use(
    http.get('*/user/payment/balance', (req, res, ctx) => {
      return HttpResponse.json({})
    }),
    http.get('*/user/payment/subscriptions', (req, res, ctx) => {
      return HttpResponse.json({})
    }),
    http.get('*/org', (req, res, ctx) => {
      return new HttpResponse(403)
    }),
  )

  const billingActor = createActor(billingMachine).start()

  const { queryByTestId } = render(<BillingRemaining
    mode={BillingRemainingMode.ProgressBarFixed}
    billingActor={billingActor}
  />)

  await act(() => {
    billingActor.send({ type: BillingTransition.Update, apiToken: "blah" })
  })

  await expect(queryByTestId('spinner')).toBeVisible()
})

test('Shows the total credits for Unknown subscription', async () => {
  const data = {
    balance: {
      monthlyApiCreditsRemaining: 10,
      stableApiCreditsRemaining: 25,
    },
    subscriptions: {
      monthlyPayAsYouGoApiCreditsTotal: 20,
      name: "unknown",
    }
  }

  server.use(
    http.get('*/user/payment/balance', (req, res, ctx) => {
      return HttpResponse.json(createUserPaymentBalanceResponse(data.balance))
    }),
    http.get('*/user/payment/subscriptions', (req, res, ctx) => {
      return HttpResponse.json(createUserPaymentSubscriptionsResponse(data.subscriptions))
    }),
    http.get('*/org', (req, res, ctx) => {
      return new HttpResponse(403)
    }),
  )

  const billingActor = createActor(billingMachine).start()

  const { queryByTestId } = render(<BillingRemaining
    mode={BillingRemainingMode.ProgressBarFixed}
    billingActor={billingActor}
  />)

  await act(() => {
    billingActor.send({ type: BillingTransition.Update, apiToken: "it doesnt matter wtf this is :)" })
  })

  const totalCredits = data.balance.monthlyApiCreditsRemaining + data.balance.stableApiCreditsRemaining
  await expect(billingActor.getSnapshot().context.credits).toBe(totalCredits)
  await within(queryByTestId('billing-credits')).getByText(totalCredits)
})

test('Progress bar reflects ratio left of Free subscription', async () => {
  const data = {
    balance: {
      monthlyApiCreditsRemaining: 10,
      stableApiCreditsRemaining: 0,
    },
    subscriptions: {
      monthlyPayAsYouGoApiCreditsTotal: 20,
      name: "free",
    }
  }

  server.use(
    http.get('*/user/payment/balance', (req, res, ctx) => {
      return HttpResponse.json(createUserPaymentBalanceResponse(data.balance))
    }),
    http.get('*/user/payment/subscriptions', (req, res, ctx) => {
      return HttpResponse.json(createUserPaymentSubscriptionsResponse(data.subscriptions))
    }),
    http.get('*/org', (req, res, ctx) => {
      return new HttpResponse(403)
    }),
  )

  const billingActor = createActor(billingMachine).start()

  const { queryByTestId } = render(<BillingRemaining
    mode={BillingRemainingMode.ProgressBarFixed}
    billingActor={billingActor}
  />)

  await act(() => {
    billingActor.send({ type: BillingTransition.Update, apiToken: "it doesnt matter wtf this is :)" })
  })

  const totalCredits = data.balance.monthlyApiCreditsRemaining + data.balance.stableApiCreditsRemaining
  const monthlyCredits = data.subscriptions.monthlyPayAsYouGoApiCreditsTotal
  const context = billingActor.getSnapshot().context
  await expect(context.credits).toBe(totalCredits)
  await expect(context.allowance).toBe(monthlyCredits)

  await within(queryByTestId('billing-credits')).getByText(totalCredits)
  await expect(queryByTestId('billing-remaining-progress-bar-inner')).toHaveStyle({
    width: "50.00%"
  })
})
test('Shows infinite credits for Pro subscription', async () => {
  const data = {
    // These are all ignored
    balance: {
      monthlyApiCreditsRemaining: 10,
      stableApiCreditsRemaining: 0,
    },
    subscriptions: {
      // This should be ignored because it's Pro tier.
      monthlyPayAsYouGoApiCreditsTotal: 20,
      name: "pro",
    }
  }

  server.use(
    http.get('*/user/payment/balance', (req, res, ctx) => {
      return HttpResponse.json(createUserPaymentBalanceResponse(data.balance))
    }),
    http.get('*/user/payment/subscriptions', (req, res, ctx) => {
      return HttpResponse.json(createUserPaymentSubscriptionsResponse(data.subscriptions))
    }),
    http.get('*/org', (req, res, ctx) => {
      return new HttpResponse(403)
    }),
  )

  const billingActor = createActor(billingMachine).start()

  const { queryByTestId } = render(<BillingRemaining
    mode={BillingRemainingMode.ProgressBarFixed}
    billingActor={billingActor}
  />)

  await act(() => {
    billingActor.send({ type: BillingTransition.Update, apiToken: "aosetuhsatuh" })
  })

  await expect(queryByTestId('infinity')).toBeVisible()
  // You can't do `.not.toBeVisible` folks. When the query fails it's because
  // no element could be found. toBeVisible should be used on an element
  // that's found but may not be visible due to `display` or others.
  await expect(queryByTestId('billing-remaining-progress-bar-inline')).toBe(null)
})
test('Shows infinite credits for Enterprise subscription', async () => {
  const data = {
    // These are all ignored, user is part of an org.
    balance: {
      monthlyApiCreditsRemaining: 10,
      stableApiCreditsRemaining: 0,
    },
    subscriptions: {
      // This should be ignored because it's Pro tier.
      monthlyPayAsYouGoApiCreditsTotal: 20,
      // This should be ignored because the user is part of an Org.
      name: "free",
    }
  }

  server.use(
    http.get('*/user/payment/balance', (req, res, ctx) => {
      return HttpResponse.json(createUserPaymentBalanceResponse(data.balance))
    }),
    http.get('*/user/payment/subscriptions', (req, res, ctx) => {
      return HttpResponse.json(createUserPaymentSubscriptionsResponse(data.subscriptions))
    }),
    // Ok finally the first use of an org lol
    http.get('*/org', (req, res, ctx) => {
      return HttpResponse.json(createOrgResponse())
    }),
  )

  const billingActor = createActor(billingMachine).start()

  const { queryByTestId } = render(<BillingRemaining
    mode={BillingRemainingMode.ProgressBarFixed}
    billingActor={billingActor}
  />)

  await act(() => {
    billingActor.send({ type: BillingTransition.Update, apiToken: "aosetuhsatuh" })
  })

  // The result should be the same as Pro users.
  await expect(queryByTestId('infinity')).toBeVisible()
  await expect(queryByTestId('billing-remaining-progress-bar-inline')).toBe(null)
})
