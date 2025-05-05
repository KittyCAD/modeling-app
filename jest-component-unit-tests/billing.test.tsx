// Test runner
import {expect, test, beforeAll, afterEach, afterAll} from '@jest/globals';

// Render mocking, DOM querying
import {act, render, screen, within} from '@testing-library/react'

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

// The data we're going to be messing with many times
// data ripped from docs.zoo.dev
const createUserPaymentBalanceResponse = (opts: {
  monthlyApiCreditsRemaining,
  stableApiCreditsRemaining,
  monthlyPayAsYouGoApiCreditsTotal,
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
  "subscription_details": {
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
      "name": "it doesnt matter yo dont look here for subscription type",
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
  },
  "subscription_id": "Hnd3jalJkHA3lb1YexOTStZtPYHTM",
  "total_due": "100.08",
  "updated_at": "2025-05-05T16:05:47.317Z"
})

test('Shows a loading spinner when unknown credit count or unexpected API data', async () => {
  server.use(
    http.get('*/user/payment/balance', (req, res, ctx) => {
      return HttpResponse.json({})
    }),
  )

  const billingActor = createActor(billingMachine).start()

  render(<BillingRemaining
    mode={BillingRemainingMode.ProgressBarFixed}
    billingActor={billingActor}
  />)

  await act(() => {
    billingActor.send({ type: BillingTransition.Update, apiToken: "blah" })
  })

  await screen.getByTestId('spinner')
})

test('Shows the total credits for Unknown subscription', async () => {
  const data = {
    monthlyApiCreditsRemaining: 10,
    stableApiCreditsRemaining: 25,
    monthlyPayAsYouGoApiCreditsTotal: 20,
  }

  server.use(
    http.get('*/user/payment/balance', (req, res, ctx) => {
      return HttpResponse.json(createUserPaymentBalanceResponse(data))
    }),
  )

  const billingActor = createActor(billingMachine).start()

  render(<BillingRemaining
    mode={BillingRemainingMode.ProgressBarFixed}
    billingActor={billingActor}
  />)

  await act(() => {
    billingActor.send({ type: BillingTransition.Update, apiToken: "it doesnt matter wtf this is :)" })
  })

  const totalCredits = data.monthlyApiCreditsRemaining + data.stableApiCreditsRemaining
  await expect(billingActor.getSnapshot().context.credits).toBe(totalCredits)
  await within(screen.getByTestId('billing-credits')).getByText(totalCredits)
})

test('Progress bar reflects ratio left of Free subscription', async () => {
  const data = {
    monthlyApiCreditsRemaining: 10,
    stableApiCreditsRemaining: 25,
    monthlyPayAsYouGoApiCreditsTotal: 20,
  }

  server.use(
    http.get('*/user/payment/balance', (req, res, ctx) => {
      return HttpResponse.json(createUserPaymentBalanceResponse(data))
    }),
  )

  const billingActor = createActor(billingMachine).start()

  render(<BillingRemaining
    mode={BillingRemainingMode.ProgressBarFixed}
    billingActor={billingActor}
  />)

  await act(() => {
    billingActor.send({ type: BillingTransition.Update, apiToken: "it doesnt matter wtf this is :)" })
  })

  const totalCredits = data.monthlyApiCreditsRemaining + data.stableApiCreditsRemaining
  await expect(billingActor.getSnapshot().context.credits).toBe(totalCredits)
  await within(screen.getByTestId('billing-credits')).getByText(totalCredits)
})
test('Shows infinite credits for Pro subscription', async () => {
  await expect(true).toBe(false)
})
test('Shows infinite credits for Enterprise subscription', async () => {
  await expect(true).toBe(false)
})
