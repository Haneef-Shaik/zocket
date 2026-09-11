import { NextResponse } from "next/server";
import { DEFAULT_API_VERSION } from "@/llm/config";
import { DEFAULT_MODEL_ID, listSharedModels } from "@/llm/models";
import { deviceCookie, identifyDevice } from "@/quota/device";
import { peekQuota, TRIAL_LIMIT } from "@/quota/quota";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * What the UI needs to render its settings panel and quota badge, without
 * spending an allowance to find out.
 */
export async function GET(req: Request) {
  const device = identifyDevice(req);
  const sharedKeyConfigured = Boolean(
    process.env.AZURE_OPENAI_API_KEY && process.env.AZURE_OPENAI_ENDPOINT,
  );

  const res = NextResponse.json({
    provider: "azure-openai",
    defaultModel: DEFAULT_MODEL_ID,
    defaultApiVersion: DEFAULT_API_VERSION,
    /** Selectable on the shared key. With your own key, any deployment works. */
    sharedModels: listSharedModels().map((m) => ({
      id: m.id,
      label: m.label,
      api: m.api,
    })),
    sharedKeyConfigured,
    trialLimit: TRIAL_LIMIT,
    quota: await peekQuota(device, "shared"),
  });

  if (device.isNew) {
    const cookie = deviceCookie(device.deviceId);
    res.cookies.set(cookie.name, cookie.value, cookie.options);
  }
  return res;
}
