import { compile, compileAccessKey } from "@/lib/compile";
import { api, body, json, textField } from "@/lib/http";
export async function POST(request: Request) {
  return api(request, async () => {
    const data = await body(request);
    const compiled = compile(textField(data.text, "Policy text"));
    return json({ ...compiled, accessKey: compileAccessKey(compiled.policy) });
  });
}

