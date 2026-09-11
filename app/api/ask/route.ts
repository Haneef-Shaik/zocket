import { NextResponse } from "next/server";
import { z } from "zod";
import { ask } from "@/agent/orchestrate";
import { CredentialsSchema, MissingCredentialsError, resolveLlmConfig } from "@/llm/config";
import { LlmError } from "@/llm/client";
import { ModelNotAllowedError } from "@/llm/models";
import { deviceCookie, identifyDevice } from "@/quota/device";
import { consumeQuota, exhaustedMessage } from "@/quota/quota";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  question: z.string().trim().min(1).max(1000),
  /** Optional bring-your-own-key block. Absent means the shared trial key. */
  credentials: CredentialsSchema.optional(),
});

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request.", details: z.treeifyError(parsed.error) },
      { status: 400 },
    );
  }
  const { question, credentials } = parsed.data;

  // Resolve credentials before touching quota: a BYOK request never consumes it.
  let config;
  try {
    config = resolveLlmConfig(credentials ?? {});
  } catch (err) {
    if (err instanceof MissingCredentialsError || err instanceof ModelNotAllowedError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }

  const device = identifyDevice(req);
  const { granted, state: quota } = await consumeQuota(device, config.mode);
  if (!granted) {
    return withCookie(
      NextResponse.json(
        { error: exhaustedMessage(), quota, code: "quota_exhausted" },
        { status: 429 },
      ),
      device,
    );
  }

  try {
    const answer = await ask(question, config);
    return withCookie(NextResponse.json({ ...answer, quota }), device);
  } catch (err) {
    return withCookie(errorResponse(err, quota), device);
  }
}

function errorResponse(err: unknown, quota: unknown) {
  const message = err instanceof Error ? err.message : "unknown error";

  if (err instanceof LlmError) {
    // Provider-side problems are the caller's to act on (wrong deployment,
    // bad key, rate limit), so the message goes through verbatim -- it is
    // already scrubbed of anything credential-shaped by toLlmError().
    return NextResponse.json({ error: message, quota }, { status: err.status ?? 502 });
  }

  // Anything else is ours. Log it server-side; do not leak internals.
  console.error("[ask] failed", err);
  return NextResponse.json({ error: "Internal error." }, { status: 500 });
}

function withCookie(res: NextResponse, device: { deviceId: string; isNew: boolean }) {
  if (device.isNew) {
    const cookie = deviceCookie(device.deviceId);
    res.cookies.set(cookie.name, cookie.value, cookie.options);
  }
  return res;
}
