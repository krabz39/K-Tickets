import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY =
  Deno.env.get("SUPABASE_ANON_KEY") ||
  Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;

const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get(
  "SUPABASE_SERVICE_ROLE_KEY",
);

const MPESA_CONSUMER_KEY = Deno.env.get("MPESA_CONSUMER_KEY");
const MPESA_CONSUMER_SECRET = Deno.env.get("MPESA_CONSUMER_SECRET");
const MPESA_SHORTCODE = Deno.env.get("MPESA_SHORTCODE");
const MPESA_TILL_NUMBER = Deno.env.get("MPESA_TILL_NUMBER");
const MPESA_PASSKEY = Deno.env.get("MPESA_PASSKEY");

const MPESA_TRANSACTION_TYPE =
  Deno.env.get("MPESA_TRANSACTION_TYPE") ||
  "CustomerBuyGoodsOnline";

const MPESA_CALLBACK_URL =
  Deno.env.get("MPESA_CALLBACK_URL") ||
  `${SUPABASE_URL}/functions/v1/mpesa-callback`;

const MPESA_ENVIRONMENT =
  Deno.env.get("MPESA_ENVIRONMENT") || "production";

const jsonHeaders = {
  ...corsHeaders,
  "Content-Type": "application/json",
};

function response(
  body: Record<string, unknown>,
  status = 200,
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: jsonHeaders,
  });
}

function normalizeKenyanPhone(input: string): string {
  let phone = String(input || "").trim();

  phone = phone.replace(/[\s\-()]/g, "");

  if (phone.startsWith("+254")) {
    phone = phone.substring(1);
  }

  if (phone.startsWith("07") || phone.startsWith("01")) {
    phone = "254" + phone.substring(1);
  }

  if (!/^254[71]\d{8}$/.test(phone)) {
    throw new Error(
      "Enter a valid Kenyan Safaricom phone number, for example 0712345678.",
    );
  }

  return phone;
}

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

function toBase64(value: string): string {
  return btoa(unescape(encodeURIComponent(value)));
}

async function getMpesaAccessToken(): Promise<string> {
  if (!MPESA_CONSUMER_KEY || !MPESA_CONSUMER_SECRET) {
    throw new Error("M-Pesa credentials are not configured.");
  }

  const baseUrl =
    MPESA_ENVIRONMENT === "sandbox"
      ? "https://sandbox.safaricom.co.ke"
      : "https://api.safaricom.co.ke";

  const credentials = `${MPESA_CONSUMER_KEY}:${MPESA_CONSUMER_SECRET}`;

  const authHeader = `Basic ${btoa(credentials)}`;

  const tokenUrl =
    `${baseUrl}/oauth/v1/generate?grant_type=client_credentials`;

  const tokenResponse = await fetch(tokenUrl, {
    method: "GET",
    headers: {
      Authorization: authHeader,
      Accept: "application/json",
    },
  });

  const tokenText = await tokenResponse.text();

  let tokenData: Record<string, unknown>;

  try {
    tokenData = JSON.parse(tokenText);
  } catch {
    throw new Error("Invalid response received from M-Pesa authorization.");
  }

  if (!tokenResponse.ok || !tokenData.access_token) {
    console.error("M-Pesa authorization failed:", {
      status: tokenResponse.status,
      error: tokenData.error,
      error_description: tokenData.error_description,
    });

    throw new Error(
      "Unable to authenticate with M-Pesa. Check the Daraja credentials and environment.",
    );
  }

  return String(tokenData.access_token);
}

async function createStkPush(params: {
  accessToken: string;
  phone: string;
  amount: number;
  accountReference: string;
  transactionDescription: string;
}) {
  if (!MPESA_SHORTCODE || !MPESA_TILL_NUMBER || !MPESA_PASSKEY) {
    throw new Error("M-Pesa Store Number, Till Number or passkey is not configured.");
  }

  const baseUrl =
    MPESA_ENVIRONMENT === "sandbox"
      ? "https://sandbox.safaricom.co.ke"
      : "https://api.safaricom.co.ke";

  const timestamp = getKenyaTimestamp();

  const passwordSource =
    MPESA_SHORTCODE +
    MPESA_PASSKEY +
    timestamp;

  const password = toBase64(passwordSource);

  const payload = {
    BusinessShortCode: MPESA_SHORTCODE,
    Password: password,
    Timestamp: timestamp,
    TransactionType: MPESA_TRANSACTION_TYPE,
    Amount: Math.round(amount),
    PartyA: params.phone,
    PartyB: MPESA_TILL_NUMBER,
    PhoneNumber: params.phone,
    CallBackURL: MPESA_CALLBACK_URL,
    AccountReference: params.accountReference,
    TransactionDesc: params.transactionDescription,
  };

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
    console.error("Invalid M-Pesa STK response:", {
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders,
    });
  }

  if (req.method !== "POST") {
    return response(
      {
        success: false,
        error: "Method not allowed.",
      },
      405,
    );
  }

  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error(
        "Supabase server configuration is incomplete.",
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
        "M-Pesa server configuration is incomplete. Check the shortcode, Till Number, passkey and Daraja credentials.",
      );
    }

    /*
     * ---------------------------------------------------------
     * 1. Authenticate the customer
     * ---------------------------------------------------------
     */

    const authHeader = req.headers.get("Authorization");

    if (!authHeader?.startsWith("Bearer ")) {
      return response(
        {
          success: false,
          error: "Authentication required.",
        },
        401,
      );
    }

    const userSupabase = createClient(
      SUPABASE_URL,
      SUPABASE_ANON_KEY,
      {
        global: {
          headers: {
            Authorization: authHeader,
          },
        },
      },
    );

    const {
      data: { user },
      error: userError,
    } = await userSupabase.auth.getUser();

    if (userError || !user) {
      return response(
        {
          success: false,
          error: "Invalid or expired login session.",
        },
        401,
      );
    }

    /*
     * ---------------------------------------------------------
     * 2. Read browser request
     *
     * We only accept IDs and phone here.
     * Amount is NEVER trusted from the browser.
     * ---------------------------------------------------------
     */

    const body = await req.json();

    const orderId = String(body?.order_id || "").trim();
    const paymentId = String(body?.payment_id || "").trim();
    const submittedPhone = String(body?.phone || "").trim();

    if (!orderId || !paymentId || !submittedPhone) {
      return response(
        {
          success: false,
          error:
            "order_id, payment_id and phone are required.",
        },
        400,
      );
    }

    /*
     * ---------------------------------------------------------
     * 3. Normalize phone
     * ---------------------------------------------------------
     */

    const phone = normalizeKenyanPhone(submittedPhone);

    /*
     * ---------------------------------------------------------
     * 4. Create trusted Supabase client
     * ---------------------------------------------------------
     */

    const adminSupabase = createClient(
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
     * ---------------------------------------------------------
     * 5. Load order
     * ---------------------------------------------------------
     */

    const {
      data: order,
      error: orderError,
    } = await adminSupabase
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
      console.error("Order lookup failed:", orderError.message);

      return response(
        {
          success: false,
          error: "Unable to load the order.",
        },
        500,
      );
    }

    if (!order) {
      return response(
        {
          success: false,
          error: "Order not found.",
        },
        404,
      );
    }

    /*
     * ---------------------------------------------------------
     * 6. Ownership check
     * ---------------------------------------------------------
     */

    if (order.user_id !== user.id) {
      return response(
        {
          success: false,
          error: "You are not authorized to pay for this order.",
        },
        403,
      );
    }

    /*
     * ---------------------------------------------------------
     * 7. Validate order state
     * ---------------------------------------------------------
     */

    if (order.status !== "awaiting_payment") {
      return response(
        {
          success: false,
          error:
            "This order is no longer awaiting payment.",
        },
        409,
      );
    }

    const amount = Number(order.total);

    if (!Number.isFinite(amount) || amount <= 0) {
      return response(
        {
          success: false,
          error: "Invalid order amount.",
        },
        400,
      );
    }

    /*
     * ---------------------------------------------------------
     * 8. Load payment
     * ---------------------------------------------------------
     */

    const {
      data: payment,
      error: paymentError,
    } = await adminSupabase
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
        paymentError.message,
      );

      return response(
        {
          success: false,
          error: "Unable to load the payment.",
        },
        500,
      );
    }

    if (!payment) {
      return response(
        {
          success: false,
          error: "Payment attempt not found.",
        },
        404,
      );
    }

    /*
     * ---------------------------------------------------------
     * 9. Payment ownership / order relationship
     * ---------------------------------------------------------
     */

    if (
      payment.user_id !== user.id ||
      payment.order_id !== order.id
    ) {
      return response(
        {
          success: false,
          error: "Invalid payment request.",
        },
        403,
      );
    }

    if (payment.method !== "mpesa") {
      return response(
        {
          success: false,
          error: "This payment attempt is not an M-Pesa payment.",
        },
        400,
      );
    }

    /*
     * ---------------------------------------------------------
     * 10. If already paid, don't initiate another STK push.
     * ---------------------------------------------------------
     */

    if (payment.status === "paid") {
      return response({
        success: true,
        already_paid: true,
        message: "Payment has already been completed.",
        payment_id: payment.id,
      });
    }

    if (
      !["pending", "processing"].includes(
        String(payment.status),
      )
    ) {
      return response(
        {
          success: false,
          error:
            `This payment cannot be initiated because its status is ${payment.status}.`,
        },
        409,
      );
    }

    /*
     * ---------------------------------------------------------
     * 11. Validate payment amount against trusted order amount
     * ---------------------------------------------------------
     */

    const paymentAmount = Number(payment.amount);

    if (
      !Number.isFinite(paymentAmount) ||
      Math.abs(paymentAmount - amount) > 0.001
    ) {
      console.error("Payment/order amount mismatch:", {
        payment_id: payment.id,
        payment_amount: paymentAmount,
        order_amount: amount,
      });

      return response(
        {
          success: false,
          error:
            "Payment amount does not match the order amount.",
        },
        409,
      );
    }


    /*
     * ---------------------------------------------------------
     * 12. Read the live exchange rate and calculate the STK
     * amount on the server. The browser never supplies an amount.
     * The order and payment records remain denominated in KWD.
     * ---------------------------------------------------------
     */

    const orderCurrency = String(
      order.currency || payment.currency || "",
    ).trim().toUpperCase();

    if (orderCurrency !== "KWD") {
      return response(
        {
          success: false,
          error:
            `M-Pesa checkout currently expects a KWD order. Received ${orderCurrency || "an unspecified currency"}.`,
        },
        400,
      );
    }

    const {
      data: platformSettings,
      error: settingsError,
    } = await adminSupabase
      .from("platform_settings")
      .select("exchange_rate")
      .eq("id", "global")
      .maybeSingle();

    if (settingsError || !platformSettings) {
      console.error(
        "Unable to load K-Tickets exchange rate:",
        settingsError?.message || "No global settings row exists.",
      );

      return response(
        {
          success: false,
          error:
            "The KWD-to-KES exchange rate is not configured. Please contact the administrator.",
        },
        503,
      );
    }

    const exchangeRate = Number(platformSettings.exchange_rate);

    if (!Number.isFinite(exchangeRate) || exchangeRate <= 0) {
      console.error("Invalid K-Tickets exchange rate in platform_settings.");

      return response(
        {
          success: false,
          error:
            "The configured KWD-to-KES exchange rate is invalid. Please contact the administrator.",
        },
        503,
      );
    }

    const amountKes = Math.round(amount * exchangeRate);

    if (!Number.isSafeInteger(amountKes) || amountKes < 1) {
      return response(
        {
          success: false,
          error: "The converted M-Pesa amount must be at least KES 1.",
        },
        400,
      );
    }

    /*
     * ---------------------------------------------------------
     * 13. Check for an existing M-Pesa transaction.
     *
     * This is backend idempotency protection.
     * ---------------------------------------------------------
     */

    const {
      data: existingMpesa,
      error: existingMpesaError,
    } = await adminSupabase
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

    if (existingMpesaError) {
      console.error(
        "M-Pesa transaction lookup failed:",
        existingMpesaError.message,
      );
    }

    if (
      existingMpesa &&
      existingMpesa.checkout_request_id &&
      ["pending", "processing"].includes(
        String(existingMpesa.status),
      )
    ) {
      return response({
        success: true,
        reused: true,
        message:
          "An M-Pesa payment request is already in progress.",
        payment_id: payment.id,
        checkout_request_id:
          existingMpesa.checkout_request_id,
        merchant_request_id:
          existingMpesa.merchant_request_id,
        phone_number: existingMpesa.phone_number,
      });
    }

    /*
     * ---------------------------------------------------------
     * 14. Get Daraja OAuth token
     * ---------------------------------------------------------
     */

    const accessToken = await getMpesaAccessToken();

    /*
     * ---------------------------------------------------------
     * 15. Build safe account reference
     * ---------------------------------------------------------
     */

    const accountReference =
      String(order.order_number || order.id)
        .replace(/[^a-zA-Z0-9_-]/g, "")
        .substring(0, 12);

    /*
     * ---------------------------------------------------------
     * 16. Initiate STK Push
     * ---------------------------------------------------------
     */

    const stk = await createStkPush({
      accessToken,
      phone,
      amount: amountKes,
      accountReference,
      transactionDescription: "K-Tickets payment",
    });

    const stkData = stk.data;

    const responseCode = String(
      stkData.ResponseCode ?? "",
    );

    /*
     * ---------------------------------------------------------
     * 17. Daraja rejected the request
     * ---------------------------------------------------------
     */

    if (
      !stkResponseSuccessful(stk.httpStatus, responseCode)
    ) {
      console.error("M-Pesa STK request rejected:", {
        http_status: stk.httpStatus,
        response_code: stkData.ResponseCode,
        response_description:
          stkData.ResponseDescription,
        customer_message:
          stkData.CustomerMessage,
        error_code: stkData.errorCode,
        error_message: stkData.errorMessage,
      });

      await adminSupabase
        .from("payments")
        .update({
          status: "failed",
          failure_reason:
            String(
              stkData.ResponseDescription ||
              stkData.errorMessage ||
              stkData.CustomerMessage ||
              "M-Pesa STK request failed.",
            ).substring(0, 500),
          updated_at: new Date().toISOString(),
        })
        .eq("id", payment.id)
        .in("status", ["pending", "processing"]);

      return response(
        {
          success: false,
          error:
            String(
              stkData.ResponseDescription ||
              stkData.CustomerMessage ||
              "M-Pesa could not start the payment request.",
            ),
        },
        502,
      );
    }

    /*
     * ---------------------------------------------------------
     * 18. Extract provider identifiers
     * ---------------------------------------------------------
     */

    const merchantRequestId = String(
      stkData.MerchantRequestID || "",
    ).trim();

    const checkoutRequestId = String(
      stkData.CheckoutRequestID || "",
    ).trim();

    if (!checkoutRequestId) {
      console.error(
        "M-Pesa returned success but no CheckoutRequestID.",
      );

      return response(
        {
          success: false,
          error:
            "M-Pesa did not return a valid checkout request.",
        },
        502,
      );
    }

    /*
     * ---------------------------------------------------------
     * 19. Record M-Pesa transaction
     * ---------------------------------------------------------
     */

    const {
      error: mpesaInsertError,
    } = await adminSupabase
      .from("mpesa_transactions")
      .insert({
        payment_id: payment.id,
        phone_number: phone,
        amount: amountKes,
        merchant_request_id:
          merchantRequestId || null,
        checkout_request_id:
          checkoutRequestId,
        status: "processing",
      });

    if (mpesaInsertError) {
      /*
       * Important:
       *
       * If the provider accepted the STK request but our
       * database insert failed, do NOT tell the customer
       * to retry automatically.
       *
       * The provider may still send the callback.
       */

      console.error(
        "Failed to store M-Pesa transaction:",
        mpesaInsertError.message,
      );

      return response(
        {
          success: false,
          error:
            "M-Pesa request was sent, but the payment record could not be saved. Please contact support before retrying.",
          provider_request_received: true,
        },
        500,
      );
    }

    /*
     * ---------------------------------------------------------
     * 20. Mark payment as processing
     * ---------------------------------------------------------
     */

    const {
      error: paymentUpdateError,
    } = await adminSupabase
      .from("payments")
      .update({
        provider: "mpesa",
        status: "processing",
        reference: checkoutRequestId,
        provider_transaction_id:
          checkoutRequestId,
        transaction_id:
          checkoutRequestId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", payment.id)
      .in("status", ["pending", "processing"]);

    if (paymentUpdateError) {
      console.error(
        "Payment update failed after STK acceptance:",
        paymentUpdateError.message,
      );

      /*
       * Do not tell the customer to retry.
       * The M-Pesa callback remains the source of truth.
       */
    }

    /*
     * ---------------------------------------------------------
     * 21. Return safe response to browser
     *
     * Never return:
     * - access token
     * - consumer secret
     * - passkey
     * - service role key
     * ---------------------------------------------------------
     */

    return response({
      success: true,
      message:
        "M-Pesa payment request sent. Check your phone and enter your M-Pesa PIN.",
      payment_id: payment.id,
      order_id: order.id,
      checkout_request_id: checkoutRequestId,
      merchant_request_id:
        merchantRequestId || null,
      phone_number: phone,
      amount: amountKes,
      amount_kes: amountKes,
      amount_kwd: amount,
      exchange_rate: exchangeRate,
      currency: "KES",
      order_currency: order.currency || payment.currency || "KWD",
    });
  } catch (error) {
    console.error(
      "mpesa-stk error:",
      error instanceof Error
        ? error.message
        : "Unknown error",
    );

    return response(
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

function stkResponseSuccessful(
  httpStatus: number,
  responseCode: string,
): boolean {
  return httpStatus >= 200 &&
    httpStatus < 300 &&
    responseCode === "0";
}