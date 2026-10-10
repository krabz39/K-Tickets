import { createClient } from "npm:@supabase/supabase-js@2";

declare const Deno: {
  env: {
    get(name: string): string | undefined;
  };
  serve(
    handler: (
      request: Request,
    ) => Response | Promise<Response>,
  ): void;
};

/*
|--------------------------------------------------------------------------
| K-TICKETS — M-PESA STK PUSH
|--------------------------------------------------------------------------
*/

function env(name: string): string {
  const runtime = globalThis as {
    Deno?: {
      env?: {
        get?: (key: string) => string | undefined;
      };
    };
  };

  return runtime.Deno?.env?.get?.(name) ?? "";
}

/*
|--------------------------------------------------------------------------
| CORS
|--------------------------------------------------------------------------
*/

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

/*
|--------------------------------------------------------------------------
| ENVIRONMENT VARIABLES
|--------------------------------------------------------------------------
*/

const SUPABASE_URL = env("SUPABASE_URL");

const SUPABASE_ANON_KEY =
  env("SUPABASE_ANON_KEY") ||
  env("SUPABASE_PUBLISHABLE_KEY");

const SUPABASE_SERVICE_ROLE_KEY =
  env("SUPABASE_SERVICE_ROLE_KEY");

const MPESA_CONSUMER_KEY =
  env("MPESA_CONSUMER_KEY");

const MPESA_CONSUMER_SECRET =
  env("MPESA_CONSUMER_SECRET");

/* Store / Head Office shortcode */
const MPESA_SHORTCODE =
  env("MPESA_SHORTCODE");

/* Actual receiving Buy Goods Till */
const MPESA_TILL_NUMBER =
  env("MPESA_TILL_NUMBER");

const MPESA_PASSKEY =
  env("MPESA_PASSKEY");

const MPESA_TRANSACTION_TYPE =
  env("MPESA_TRANSACTION_TYPE") ||
  "CustomerBuyGoodsOnline";

const MPESA_ENVIRONMENT =
  env("MPESA_ENVIRONMENT") ||
  "production";

const MPESA_CALLBACK_URL =
  env("MPESA_CALLBACK_URL") ||
  `${SUPABASE_URL}/functions/v1/mpesa-callback`;

/*
|--------------------------------------------------------------------------
| RESPONSE HELPERS
|--------------------------------------------------------------------------
*/

function jsonResponse(
  body: Record<string, unknown>,
  status = 200,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders,
  });
}

function businessError(
  message: string,
  extra: Record<string, unknown> = {},
): Response {
  return jsonResponse({
    success: false,
    error: message,
    ...extra,
  });
}

/*
|--------------------------------------------------------------------------
| PHONE NORMALIZATION
|--------------------------------------------------------------------------
*/

function normalizeKenyanPhone(input: string): string {
  let phone = String(input ?? "").trim();

  phone = phone.replace(/[\s\-()]/g, "");

  if (phone.startsWith("+254")) {
    phone = phone.substring(1);
  }

  if (phone.startsWith("07") || phone.startsWith("01")) {
    phone = `254${phone.substring(1)}`;
  }

  if (!/^254[71]\d{8}$/.test(phone)) {
    throw new Error(
      "Enter a valid Kenyan Safaricom phone number, for example 0712345678.",
    );
  }

  return phone;
}

/*
|--------------------------------------------------------------------------
| KENYA TIMESTAMP
|--------------------------------------------------------------------------
*/

function getKenyaTimestamp(): string {
  const now = new Date();

  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  const parts = formatter.formatToParts(now);
  const values: Record<string, string> = {};

  for (const part of parts) {
    if (part.type !== "literal") {
      values[part.type] = part.value;
    }
  }

  return (
    values.year +
    values.month +
    values.day +
    values.hour +
    values.minute +
    values.second
  );
}

/*
|--------------------------------------------------------------------------
| STK PASSWORD
|--------------------------------------------------------------------------
*/

function createStkPassword(
  shortcode: string,
  passkey: string,
  timestamp: string,
): string {
  return btoa(`${shortcode}${passkey}${timestamp}`);
}

/*
|--------------------------------------------------------------------------
| DARAJA BASE URL
|--------------------------------------------------------------------------
*/

function getMpesaBaseUrl(): string {
  if (MPESA_ENVIRONMENT.toLowerCase().trim() === "sandbox") {
    return "https://sandbox.safaricom.co.ke";
  }

  return "https://api.safaricom.co.ke";
}

/*
|--------------------------------------------------------------------------
| DARAJA ACCESS TOKEN
|--------------------------------------------------------------------------
*/

async function getMpesaAccessToken(): Promise<string> {
  if (!MPESA_CONSUMER_KEY || !MPESA_CONSUMER_SECRET) {
    throw new Error(
      "M-Pesa consumer credentials are not configured.",
    );
  }

  const baseUrl = getMpesaBaseUrl();

  const credentials =
    `${MPESA_CONSUMER_KEY}:${MPESA_CONSUMER_SECRET}`;

  const basicAuth = btoa(credentials);

  const tokenUrl =
    `${baseUrl}/oauth/v1/generate?grant_type=client_credentials`;

  console.log("Requesting M-Pesa OAuth token.", {
    environment: MPESA_ENVIRONMENT,
  });

  const tokenResponse = await fetch(tokenUrl, {
    method: "GET",
    headers: {
      Authorization: `Basic ${basicAuth}`,
      Accept: "application/json",
    },
  });

  const responseText = await tokenResponse.text();

  let tokenData: Record<string, unknown>;

  try {
    tokenData = JSON.parse(responseText);
  } catch {
    console.error("M-Pesa OAuth returned non-JSON response.", {
      status: tokenResponse.status,
    });

    throw new Error(
      "Invalid response received from M-Pesa authorization.",
    );
  }

  if (!tokenResponse.ok || !tokenData.access_token) {
    console.error("M-Pesa authorization failed.", {
      status: tokenResponse.status,
      error: tokenData.error,
      error_description: tokenData.error_description,
    });

    throw new Error(
      "Unable to authenticate with M-Pesa. Check your Daraja credentials and environment.",
    );
  }

  return String(tokenData.access_token);
}

/*
|--------------------------------------------------------------------------
| SEND STK PUSH
|--------------------------------------------------------------------------
*/

async function sendStkPush(params: {
  accessToken: string;
  phone: string;
  amount: number;
  accountReference: string;
  transactionDescription: string;
}) {
  if (
    !MPESA_SHORTCODE ||
    !MPESA_TILL_NUMBER ||
    !MPESA_PASSKEY
  ) {
    throw new Error(
      "M-Pesa Store Number, Till Number or passkey is not configured.",
    );
  }

  const baseUrl = getMpesaBaseUrl();
  const timestamp = getKenyaTimestamp();

  /*
   * The password uses the shortcode associated with
   * the passkey issued for this STK configuration.
   */
  const password = createStkPassword(
    MPESA_SHORTCODE,
    MPESA_PASSKEY,
    timestamp,
  );

  const amount = Math.round(params.amount);

  const payload = {
    BusinessShortCode: MPESA_SHORTCODE,
    Password: password,
    Timestamp: timestamp,
    TransactionType: MPESA_TRANSACTION_TYPE,
    Amount: amount,
    PartyA: params.phone,

    /* Receiving Buy Goods Till */
    PartyB: MPESA_TILL_NUMBER,

    PhoneNumber: params.phone,
    CallBackURL: MPESA_CALLBACK_URL,
    AccountReference: params.accountReference,
    TransactionDesc: params.transactionDescription,
  };

  console.log("Sending M-Pesa STK Push.", {
    environment: MPESA_ENVIRONMENT,
    transaction_type: MPESA_TRANSACTION_TYPE,
    amount,
    callback_configured: Boolean(MPESA_CALLBACK_URL),
    shortcode_configured: Boolean(MPESA_SHORTCODE),
    till_number_configured: Boolean(MPESA_TILL_NUMBER),
    party_b_matches_shortcode:
      MPESA_TILL_NUMBER === MPESA_SHORTCODE,
  });

  const stkUrl =
    `${baseUrl}/mpesa/stkpush/v1/processrequest`;

  const stkResponse = await fetch(stkUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
  });

  const responseText = await stkResponse.text();

  let data: Record<string, unknown>;

  try {
    data = JSON.parse(responseText);
  } catch {
    console.error("M-Pesa STK returned invalid JSON.", {
      status: stkResponse.status,
    });

    throw new Error(
      "M-Pesa returned an invalid response.",
    );
  }

  return {
    httpStatus: stkResponse.status,
    data,
  };
}

/*
|--------------------------------------------------------------------------
| SUCCESS CHECK
|--------------------------------------------------------------------------
*/

function isSuccessfulStkResponse(
  httpStatus: number,
  responseCode: string,
): boolean {
  return (
    httpStatus >= 200 &&
    httpStatus < 300 &&
    responseCode === "0"
  );
}

/*
|--------------------------------------------------------------------------
| MAIN HANDLER
|--------------------------------------------------------------------------
*/

Deno.serve(async (req: Request): Promise<Response> => {
  /*
  |--------------------------------------------------------------------------
  | CORS
  |--------------------------------------------------------------------------
  */

  if (req.method === "OPTIONS") {
    return new Response("ok", {
      status: 200,
      headers: corsHeaders,
    });
  }

  /*
  |--------------------------------------------------------------------------
  | POST ONLY
  |--------------------------------------------------------------------------
  */

  if (req.method !== "POST") {
    return businessError("Method not allowed.", {
      allowed_methods: ["POST"],
    });
  }

  try {
    /*
    |--------------------------------------------------------------------------
    | SERVER CONFIGURATION
    |--------------------------------------------------------------------------
    */

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error(
        "Supabase server configuration is incomplete.",
      );
    }

    if (!SUPABASE_ANON_KEY) {
      throw new Error(
        "Supabase public authentication key is not configured.",
      );
    }

    if (
      !MPESA_CONSUMER_KEY ||
      !MPESA_CONSUMER_SECRET ||
      !MPESA_SHORTCODE ||
      !MPESA_TILL_NUMBER ||
      !MPESA_PASSKEY
    ) {
      throw new Error(
        "M-Pesa server configuration is incomplete.",
      );
    }

    /*
    |--------------------------------------------------------------------------
    | AUTHENTICATE CUSTOMER
    |--------------------------------------------------------------------------
    */

    const authorization = req.headers.get("Authorization");

    if (!authorization || !authorization.startsWith("Bearer ")) {
      return businessError("Authentication required.");
    }

    const userClient = createClient(
      SUPABASE_URL,
      SUPABASE_ANON_KEY,
      {
        global: {
          headers: {
            Authorization: authorization,
          },
        },
      },
    );

    const {
      data: { user },
      error: authError,
    } = await userClient.auth.getUser();

    if (authError || !user) {
      return businessError(
        "Invalid or expired login session.",
      );
    }

    /*
    |--------------------------------------------------------------------------
    | READ REQUEST
    |--------------------------------------------------------------------------
    */

    let body: Record<string, unknown>;

    try {
      body = await req.json();
    } catch {
      return businessError("Invalid JSON request.");
    }

    const orderId = String(body.order_id ?? "").trim();
    const paymentId = String(body.payment_id ?? "").trim();
    const submittedPhone = String(body.phone ?? "").trim();

    if (!orderId || !paymentId || !submittedPhone) {
      return businessError(
        "order_id, payment_id and phone are required.",
      );
    }

    /*
    |--------------------------------------------------------------------------
    | NORMALIZE PHONE
    |--------------------------------------------------------------------------
    */

    let phone: string;

    try {
      phone = normalizeKenyanPhone(submittedPhone);
    } catch (error) {
      return businessError(
        error instanceof Error
          ? error.message
          : "Invalid phone number.",
      );
    }

    /*
    |--------------------------------------------------------------------------
    | SERVICE ROLE CLIENT
    |--------------------------------------------------------------------------
    */

    const adminClient = createClient(
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      },
    );

    /*
    |--------------------------------------------------------------------------
    | LOAD ORDER
    |--------------------------------------------------------------------------
    */

    const {
      data: order,
      error: orderError,
    } = await adminClient
      .from("orders")
      .select(`
        id,
        order_number,
        user_id,
        event_id,
        status,
        subtotal,
        service_fee_percentage,
        service_fee,
        discount,
        total,
        currency,
        promotion_id
      `)
      .eq("id", orderId)
      .maybeSingle();

    if (orderError) {
      console.error("Order lookup failed:", orderError);

      return businessError("Unable to load the order.", {
        details: orderError.message,
      });
    }

    if (!order) {
      return businessError("Order not found.");
    }

    /*
    |--------------------------------------------------------------------------
    | VERIFY ORDER OWNERSHIP
    |--------------------------------------------------------------------------
    */

    if (order.user_id !== user.id) {
      return businessError(
        "You are not authorized to pay for this order.",
      );
    }

    /*
    |--------------------------------------------------------------------------
    | VERIFY ORDER STATUS
    |--------------------------------------------------------------------------
    */

    if (order.status !== "awaiting_payment") {
      return businessError(
        "This order is no longer awaiting payment.",
        {
          order_status: order.status,
        },
      );
    }

    /*
    |--------------------------------------------------------------------------
    | TRUSTED ORDER AMOUNT
    |--------------------------------------------------------------------------
    */

    const orderAmount = Number(order.total);

    if (!Number.isFinite(orderAmount) || orderAmount <= 0) {
      return businessError(
        "The order has an invalid payment amount.",
      );
    }

    /*
    |--------------------------------------------------------------------------
    | VERIFY ORDER CURRENCY AND LOAD LIVE EXCHANGE RATE
    |--------------------------------------------------------------------------
    |
    | The order total is maintained in KWD.
    | Daraja receives the converted amount in KES.
    | The rate is read server-side, not trusted from the browser.
    |
    */

    const orderCurrency = String(order.currency ?? "")
      .trim()
      .toUpperCase();

    if (orderCurrency !== "KWD") {
      return businessError(
        "M-Pesa checkout currently supports KWD orders only.",
        {
          order_currency: orderCurrency || null,
        },
      );
    }

    const {
      data: platformSettings,
      error: settingsError,
    } = await adminClient
      .from("platform_settings")
      .select("exchange_rate")
      .eq("id", "global")
      .maybeSingle();

    if (settingsError) {
      console.error(
        "Exchange-rate lookup failed:",
        settingsError,
      );

      return businessError(
        "Unable to load the current KWD to KES exchange rate. Please try again.",
      );
    }

    const exchangeRate = Number(
      platformSettings?.exchange_rate,
    );

    if (
      !Number.isFinite(exchangeRate) ||
      exchangeRate <= 0
    ) {
      console.error(
        "Invalid platform_settings.exchange_rate.",
        {
          exchangeRate: platformSettings?.exchange_rate,
        },
      );

      return businessError(
        "The KWD to KES exchange rate is not configured correctly.",
      );
    }

    /*
     * Convert the trusted order total to whole Kenyan shillings.
     * Example: 2 KWD × 427 = 854 KES.
     */
    const amountKes = Math.round(
      orderAmount * exchangeRate,
    );

    if (
      !Number.isSafeInteger(amountKes) ||
      amountKes < 1
    ) {
      return businessError(
        "The converted M-Pesa payment amount is invalid.",
      );
    }

    /*
    |--------------------------------------------------------------------------
    | LOAD PAYMENT
    |--------------------------------------------------------------------------
    */

    const {
      data: payment,
      error: paymentError,
    } = await adminClient
      .from("payments")
      .select(`
        id,
        order_id,
        user_id,
        event_id,
        method,
        provider,
        status,
        amount,
        currency,
        reference,
        transaction_id,
        receipt_number,
        provider_transaction_id,
        failure_reason,
        paid_at
      `)
      .eq("id", paymentId)
      .maybeSingle();

    if (paymentError) {
      console.error(
        "Payment lookup failed:",
        paymentError,
      );

      return businessError(
        "Unable to load the payment attempt.",
        {
          details: paymentError.message,
        },
      );
    }

    if (!payment) {
      return businessError("Payment attempt not found.");
    }

    /*
    |--------------------------------------------------------------------------
    | VERIFY PAYMENT OWNERSHIP
    |--------------------------------------------------------------------------
    */

    if (
      payment.user_id !== user.id ||
      payment.order_id !== order.id
    ) {
      return businessError("Invalid payment request.");
    }

    /*
    |--------------------------------------------------------------------------
    | VERIFY PAYMENT METHOD
    |--------------------------------------------------------------------------
    */

    if (
      String(payment.method).toLowerCase() !== "mpesa"
    ) {
      return businessError(
        "This payment attempt is not an M-Pesa payment.",
      );
    }

    /*
    |--------------------------------------------------------------------------
    | ALREADY PAID
    |--------------------------------------------------------------------------
    */

    if (payment.status === "paid") {
      return jsonResponse({
        success: true,
        already_paid: true,
        message: "Payment has already been completed.",
        payment_id: payment.id,
      });
    }

    /*
    |--------------------------------------------------------------------------
    | VALID PAYMENT STATES
    |--------------------------------------------------------------------------
    */

    if (
      !["pending", "processing"].includes(
        String(payment.status),
      )
    ) {
      return businessError(
        `This payment cannot be initiated because its status is ${payment.status}.`,
        {
          payment_status: payment.status,
        },
      );
    }

    /*
    |--------------------------------------------------------------------------
    | VERIFY PAYMENT AMOUNT AND CURRENCY
    |--------------------------------------------------------------------------
    */

    const paymentAmount = Number(payment.amount);

    if (
      !Number.isFinite(paymentAmount) ||
      Math.abs(paymentAmount - orderAmount) > 0.001
    ) {
      console.error(
        "Payment/order amount mismatch.",
        {
          paymentId: payment.id,
          paymentAmount,
          orderAmount,
        },
      );

      return businessError(
        "Payment amount does not match the order amount.",
        {
          payment_amount: paymentAmount,
          order_amount: orderAmount,
        },
      );
    }

    const paymentCurrency = String(payment.currency ?? "")
      .trim()
      .toUpperCase();

    if (
      paymentCurrency &&
      paymentCurrency !== "KWD"
    ) {
      return businessError(
        "Payment currency does not match the KWD order.",
        {
          payment_currency: paymentCurrency,
        },
      );
    }

    /*
    |--------------------------------------------------------------------------
    | CHECK EXISTING M-PESA TRANSACTION
    |--------------------------------------------------------------------------
    */

    const {
      data: existingTransaction,
      error: existingTransactionError,
    } = await adminClient
      .from("mpesa_transactions")
      .select(`
        id,
        payment_id,
        phone_number,
        amount,
        merchant_request_id,
        checkout_request_id,
        status,
        created_at,
        updated_at
      `)
      .eq("payment_id", payment.id)
      .order("created_at", {
        ascending: false,
      })
      .limit(1)
      .maybeSingle();

    if (existingTransactionError) {
      console.error(
        "Existing M-Pesa transaction lookup failed:",
        existingTransactionError,
      );
    }

    if (
      existingTransaction &&
      existingTransaction.checkout_request_id &&
      ["pending", "processing"].includes(
        String(existingTransaction.status),
      )
    ) {
      return jsonResponse({
        success: true,
        reused: true,
        message:
          "An M-Pesa payment request is already in progress.",
        payment_id: payment.id,
        checkout_request_id:
          existingTransaction.checkout_request_id,
        merchant_request_id:
          existingTransaction.merchant_request_id,
        phone_number: existingTransaction.phone_number,
      });
    }

    /*
    |--------------------------------------------------------------------------
    | GET DARAJA TOKEN
    |--------------------------------------------------------------------------
    */

    let accessToken: string;

    try {
      accessToken = await getMpesaAccessToken();
    } catch (error) {
      console.error(
        "M-Pesa authorization error:",
        error,
      );

      return businessError(
        error instanceof Error
          ? error.message
          : "Unable to authenticate with M-Pesa.",
      );
    }

    /*
    |--------------------------------------------------------------------------
    | ACCOUNT REFERENCE
    |--------------------------------------------------------------------------
    */

    const accountReference = String(
      order.order_number || order.id,
    )
      .replace(/[^a-zA-Z0-9_-]/g, "")
      .substring(0, 12);

    /*
    |--------------------------------------------------------------------------
    | SEND STK PUSH
    |--------------------------------------------------------------------------
    */

    let stk;

    try {
      stk = await sendStkPush({
        accessToken,
        phone,

        /* M-Pesa receives KES, not the KWD order total. */
        amount: amountKes,

        accountReference,
        transactionDescription: "K-Tickets payment",
      });
    } catch (error) {
      console.error(
        "M-Pesa STK request error:",
        error,
      );

      return businessError(
        error instanceof Error
          ? error.message
          : "Unable to send M-Pesa payment request.",
      );
    }

    const stkData = stk.data;

    const responseCode = String(
      stkData.ResponseCode ?? "",
    );

    /*
    |--------------------------------------------------------------------------
    | DARAJA REJECTED REQUEST
    |--------------------------------------------------------------------------
    */

    if (
      !isSuccessfulStkResponse(
        stk.httpStatus,
        responseCode,
      )
    ) {
      const providerMessage = String(
        stkData.ResponseDescription ??
          stkData.CustomerMessage ??
          stkData.errorMessage ??
          "M-Pesa STK request failed.",
      );

      console.error(
        "M-Pesa STK request rejected.",
        {
          httpStatus: stk.httpStatus,
          responseCode,
          responseDescription:
            stkData.ResponseDescription,
          customerMessage: stkData.CustomerMessage,
          errorCode: stkData.errorCode,
          errorMessage: stkData.errorMessage,
        },
      );

      /*
      |--------------------------------------------------------------------------
      | MARK PAYMENT FAILED
      |--------------------------------------------------------------------------
      */

      const {
        error: failureUpdateError,
      } = await adminClient
        .from("payments")
        .update({
          status: "failed",
          failure_reason:
            providerMessage.substring(0, 500),
          updated_at: new Date().toISOString(),
        })
        .eq("id", payment.id)
        .in("status", ["pending", "processing"]);

      if (failureUpdateError) {
        console.error(
          "Could not mark payment failed:",
          failureUpdateError,
        );
      }

      return businessError(providerMessage, {
        provider_http_status: stk.httpStatus,
        provider_response_code: responseCode,
      });
    }

    /*
    |--------------------------------------------------------------------------
    | PROVIDER IDENTIFIERS
    |--------------------------------------------------------------------------
    */

    const merchantRequestId = String(
      stkData.MerchantRequestID ?? "",
    ).trim();

    const checkoutRequestId = String(
      stkData.CheckoutRequestID ?? "",
    ).trim();

    if (!checkoutRequestId) {
      console.error(
        "M-Pesa returned success without CheckoutRequestID.",
        {
          response: stkData,
        },
      );

      return businessError(
        "M-Pesa did not return a valid checkout request.",
      );
    }

    /*
    |--------------------------------------------------------------------------
    | SAVE M-PESA TRANSACTION
    |--------------------------------------------------------------------------
    |
    | mpesa_transactions.amount stores the KES amount sent to
    | Daraja. payments.amount and orders.total remain in KWD.
    |
    */

    const {
      error: transactionInsertError,
    } = await adminClient
      .from("mpesa_transactions")
      .insert({
        payment_id: payment.id,
        order_id: order.id,
        user_id: user.id,
        phone_number: phone,

        /* Store the amount expected from the M-Pesa callback. */
        amount: amountKes,

        merchant_request_id:
          merchantRequestId || null,
        checkout_request_id: checkoutRequestId,
        status: "processing",
      });

    if (transactionInsertError) {
      console.error(
        "Failed to save M-Pesa transaction after provider acceptance:",
        transactionInsertError,
      );

      return businessError(
        "M-Pesa accepted the payment request, but K-Tickets could not save the payment record. Please do not retry immediately.",
        {
          provider_request_received: true,
          checkout_request_id: checkoutRequestId,
        },
      );
    }

    /*
    |--------------------------------------------------------------------------
    | UPDATE PAYMENT
    |--------------------------------------------------------------------------
    */

    const {
      error: paymentUpdateError,
    } = await adminClient
      .from("payments")
      .update({
        provider: "mpesa",
        status: "processing",
        reference: checkoutRequestId,
        provider_transaction_id: checkoutRequestId,
        transaction_id: checkoutRequestId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", payment.id)
      .in("status", ["pending", "processing"]);

    if (paymentUpdateError) {
      console.error(
        "Payment update failed after STK acceptance:",
        paymentUpdateError,
      );
    }

    /*
    |--------------------------------------------------------------------------
    | SUCCESS
    |--------------------------------------------------------------------------
    */

    return jsonResponse({
      success: true,
      message:
        "M-Pesa payment request sent. Check your phone and enter your M-Pesa PIN.",
      payment_id: payment.id,
      order_id: order.id,
      checkout_request_id: checkoutRequestId,
      merchant_request_id:
        merchantRequestId || null,
      phone_number: phone,

      /* KES amount requested from M-Pesa */
      amount: amountKes,
      amount_kes: amountKes,

      /* Original order total */
      amount_kwd: orderAmount,

      exchange_rate: exchangeRate,
      currency: "KES",
      order_currency: order.currency,
    });
  } catch (error) {
    console.error(
      "mpesa-stk unexpected error:",
      error instanceof Error
        ? error.message
        : error,
    );

    return jsonResponse(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to start M-Pesa payment.",
      },
      500,
    );
  }
});