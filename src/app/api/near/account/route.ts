import { api, HttpError, json } from "@/lib/http";
import { nearReader } from "@/lib/near";
import { isAccountId } from "@/lib/policy";
export async function GET(request: Request) {
  return api(request, async () => {
    const id = new URL(request.url).searchParams.get("id") ?? "";
    if (!isAccountId(id))
      throw new HttpError(
        400,
        "Enter a valid NEAR account ID (2–64 lowercase ASCII characters).",
      );
    try {
      return json(await nearReader.account(id));
    } catch {
      throw new HttpError(
        502,
        "The view-only RPC could not read this account. Check its network or try again shortly.",
      );
    }
  });
}
