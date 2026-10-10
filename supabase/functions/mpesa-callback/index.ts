import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Missing Supabase environment variables");
}

const supabase = createClient(
  supabaseUrl,
  serviceRoleKey,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  },
);

function jsonResponse(
  body: Record<string, unknown>,
  status = 200,
) {
  return new Response(
    JSON.stringify(body),
    {
      status,
      headers: {
        "Content-Type": "application/json",
      },
    },
  );
}

function getCallbackMetadata(
  stkCallback: Record<string, unknown>,
) {
  const metadata =
    (stkCallback.CallbackMetadata as Record<string, unknown> | undefined);

  const items =
    Array.isArray(metadata?.Item)
      ? metadata.Item as Array<Record<string, unknown>>
      : [];

  const getValue = (name: string) => {
    const item = items.find(
      (entry) => entry.Name === name,
    );

    return item?.Value ?? null;
  };

  return {
    amount: getValue("Amount"),
    receiptNumber: getValue("MpesaReceiptNumber"),
    phoneNumber: getValue("PhoneNumber"),
    transactionDate: getValue("TransactionDate"),
  };
}

Deno.serve(async (req) => {
  // Daraja sends the callback as POST.
  if (req.method !== "POST") {
    return jsonResponse(
      {
        success: false,
        error: "Method not allowed",
      },
      405,
    );
  }

  let body: Record<string, unknown>;

  try {
    body = await req.json();
  } catch {
    return jsonResponse(
      {
        success: false,
        error: "Invalid JSON payload",
      },
      200,
    );
  }

  try {
    const stkCallback =
      (
        body.Body as Record<string, unknown> | undefined
      )?.stkCallback as Record<string, unknown> | undefined;

    if (!stkCallback) {
      return jsonResponse({
        success: false,
        error: "Invalid STK callback structure",
      });
    }

    const checkoutRequestId =
      String(stkCallback.CheckoutRequestID ?? "");

    const merchantRequestId =
      stkCallback.MerchantRequestID
        ? String(stkCallback.MerchantRequestID)
        : null;

    const resultCode =
      typeof stkCallback.ResultCode === "number"
        ? stkCallback.ResultCode
        : Number(stkCallback.ResultCode ?? 0);

    const resultDescription =
      stkCallback.ResultDesc
        ? String(stkCallback.ResultDesc)
        : null;

    if (!checkoutRequestId) {
      return jsonResponse({
        success: false,
        error: "Missing CheckoutRequestID",
      });
    }

    const metadata = getCallbackMetadata(stkCallback);

    const amount =
      metadata.amount !== null
        ? Number(metadata.amount)
        : null;

    const receiptNumber =
      metadata.receiptNumber !== null
        ? String(metadata.receiptNumber)
        : null;

    const phoneNumber =
      metadata.phoneNumber !== null
        ? String(metadata.phoneNumber)
        : null;

    const transactionDate =
      metadata.transactionDate !== null
        ? String(metadata.transactionDate)
        : null;

    /*
     * Find the payment associated with this CheckoutRequestID.
     */
    const { data: paymentLookup, error: lookupError } =
      await supabase.rpc(
        "get_mpesa_payment_by_checkout_request",
        {
          p_checkout_request_id: checkoutRequestId,
        },
      );

    if (lookupError) {
      console.error(
        "Payment lookup failed:",
        lookupError,
      );

      return jsonResponse({
        success: false,
        error: "Payment lookup failed",
      });
    }

    const payment =
      Array.isArray(paymentLookup)
        ? paymentLookup[0]
        : paymentLookup;

    if (!payment) {
      console.error(
        "No payment found for CheckoutRequestID:",
        checkoutRequestId,
      );

      return jsonResponse({
        success: false,
        error: "Payment not found",
      });
    }

    /*
     * Log the callback before processing it.
     */
    const { data: callbackLogId, error: logError } =
      await supabase.rpc(
        "log_mpesa_callback",
        {
          p_checkout_request_id: checkoutRequestId,
          p_merchant_request_id: merchantRequestId,
          p_result_code: resultCode,
          p_result_description: resultDescription,
          p_amount: amount,
          p_mpesa_receipt_number: receiptNumber,
          p_phone_number: phoneNumber,
          p_callback_status:
            resultCode === 0
              ? "success"
              : "failed",
          p_provider_reference:
            receiptNumber ?? checkoutRequestId,
          p_callback_payload: body,
        },
      );

    if (logError) {
      console.error(
        "Callback logging failed:",
        logError,
      );

      return jsonResponse({
        success: false,
        error: "Callback logging failed",
      });
    }

    /*
     * Process the callback.
     *
     * process_mpesa_callback() performs:
     * - payment locking
     * - idempotency
     * - amount validation
     * - M-Pesa transaction update
     * - payment finalization
     * - ticket issuance
     * - inventory consumption
     */
    const { data: processingResult, error: processingError } =
      await supabase.rpc(
        "process_mpesa_callback",
        {
          p_checkout_request_id: checkoutRequestId,
          p_merchant_request_id: merchantRequestId,
          p_result_code: resultCode,
          p_result_description: resultDescription,
          p_amount: amount,
          p_mpesa_receipt_number: receiptNumber,
          p_phone_number: phoneNumber,
          p_callback_payload: JSON.stringify(body),
          p_callback_status:
            resultCode === 0
              ? "success"
              : "failed",
          p_transaction_id: transactionDate,
          p_provider_reference:
            receiptNumber ?? checkoutRequestId,
        },
      );

    if (processingError) {
      console.error(
        "M-Pesa callback processing failed:",
        processingError,
      );

      /*
       * Record the processing failure.
       * We still return HTTP 200 to Daraja so the callback
       * endpoint itself is acknowledged.
       */
      if (callbackLogId) {
        await supabase.rpc(
          "finalize_mpesa_callback_log",
          {
            p_log_id: callbackLogId,
            p_processing_status: "failed",
            p_payment_id: payment.id,
            p_mpesa_transaction_id:
              payment.mpesa_transaction_id ?? null,
            p_error_message:
              processingError.message,
          },
        );
      }

      return jsonResponse({
        success: false,
        acknowledged: true,
        error: "Callback processing failed",
      });
    }

    /*
     * Mark callback log as processed.
     */
    if (callbackLogId) {
      await supabase.rpc(
        "finalize_mpesa_callback_log",
        {
          p_log_id: callbackLogId,
          p_processing_status:
            processingResult?.already_processed
              ? "already_processed"
              : "processed",
          p_payment_id: payment.id,
          p_mpesa_transaction_id:
            payment.mpesa_transaction_id ?? null,
          p_error_message: null,
        },
      );
    }

    return jsonResponse({
      success: true,
      acknowledged: true,
      result: processingResult,
    });
  } catch (error) {
    console.error(
      "Unexpected callback error:",
      error,
    );

    /*
     * Always acknowledge Daraja at HTTP level.
     * Internal failures are recorded separately.
     */
    return jsonResponse({
      success: false,
      acknowledged: true,
      error: "Internal callback processing error",
    });
  }
});