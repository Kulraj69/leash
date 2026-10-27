import {
  baseReader,
  parsePaymentPreview,
  type PaymentPreview,
} from "@/lib/base";
import { api, body, HttpError, json } from "@/lib/http";

async function readVault(preview?: PaymentPreview) {
  try {
    return json(await baseReader.vault(preview));
  } catch {
    // Never reflect provider errors, RPC URLs, or server environment values.
    throw new HttpError(
      502,
      "The view-only Base RPC could not read this vault. Check the configured Base Sepolia address and RPC, then retry.",
    );
  }
}

export async function GET(request: Request) {
  return api(request, async () => {
    const params = new URL(request.url).searchParams;
    const preview =
      params.has("to") || params.has("amountWei")
        ? parsePaymentPreview({
            to: params.get("to"),
            amountWei: params.get("amountWei"),
          })
        : undefined;
    return readVault(preview);
  });
}

/** A read-only preview, despite POST accepting its parameters in a JSON body. */
export async function POST(request: Request) {
  return api(request, async () =>
    readVault(parsePaymentPreview(await body(request))),
  );
}
