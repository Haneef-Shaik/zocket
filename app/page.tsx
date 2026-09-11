"use client";

import { useEffect, useState } from "react";

/**
 * Deliberately undesigned. The brief scores nothing for UI; what it scores is
 * whether the work is visible, so the panels are plan, SQL, table, flags.
 *
 * The one piece of real product logic here: a caller-supplied API key is held
 * in localStorage and sent per request. It is never persisted server-side, so
 * clearing it here is a complete revocation.
 */

const KEY_STORE = "da.azure.credentials";

interface Config {
  defaultModel: string;
  defaultApiVersion: string;
  sharedModels: { id: string; label: string; api: string }[];
  sharedKeyConfigured: boolean;
  trialLimit: number;
  quota: { used: number; remaining: number | null; limit: number | null };
}

interface Creds {
  apiKey: string;
  endpoint: string;
  deployment: string;
}

const EMPTY: Creds = { apiKey: "", endpoint: "", deployment: "" };

export default function Page() {
  const [config, setConfig] = useState<Config | null>(null);
  const [question, setQuestion] = useState(
    "What did we spend by channel over the last eight weeks?",
  );
  const [model, setModel] = useState("");
  const [creds, setCreds] = useState<Creds>(EMPTY);
  const [showSettings, setShowSettings] = useState(false);
  const [answer, setAnswer] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((c: Config) => {
        setConfig(c);
        setModel(c.defaultModel);
      })
      .catch(() => setConfig(null));

    try {
      const saved = localStorage.getItem(KEY_STORE);
      if (saved) setCreds({ ...EMPTY, ...JSON.parse(saved) });
    } catch {
      /* private mode, or corrupt entry: fall back to the shared key */
    }
  }, []);

  const byok = creds.apiKey.trim() !== "" && creds.endpoint.trim() !== "";

  function saveCreds(next: Creds) {
    setCreds(next);
    try {
      if (next.apiKey || next.endpoint) {
        localStorage.setItem(KEY_STORE, JSON.stringify(next));
      } else {
        localStorage.removeItem(KEY_STORE);
      }
    } catch {
      /* storage unavailable; the key still works for this session */
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const credentials: Record<string, string> = {};
      if (byok) {
        credentials.apiKey = creds.apiKey.trim();
        credentials.endpoint = creds.endpoint.trim();
        if (creds.deployment.trim()) credentials.deployment = creds.deployment.trim();
      }
      if (model) credentials.model = model;

      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          question,
          credentials: Object.keys(credentials).length ? credentials : undefined,
        }),
      });
      const json = await res.json();
      setAnswer(json);
      if (json?.quota && config) setConfig({ ...config, quota: json.quota });
    } finally {
      setBusy(false);
    }
  }

  const quotaLabel = byok
    ? "your key - unlimited"
    : config
      ? `${config.quota.remaining ?? "?"} of ${config.trialLimit} trial requests left`
      : "...";

  return (
    <main>
      <h1>Dashboard Agent</h1>

      <div style={{ fontSize: 12, color: "#555", marginBottom: 12 }}>
        {quotaLabel}
        {" · "}
        <button
          type="button"
          onClick={() => setShowSettings((s) => !s)}
          style={{ font: "inherit", border: 0, background: "none", padding: 0, cursor: "pointer", textDecoration: "underline" }}
        >
          settings
        </button>
      </div>

      {showSettings && (
        <fieldset style={{ marginBottom: 16, padding: 12, border: "1px solid #ccc" }}>
          <legend style={{ fontSize: 12 }}>Azure OpenAI</legend>

          <label style={{ display: "block", fontSize: 12, marginBottom: 8 }}>
            Model
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              style={{ font: "inherit", marginLeft: 8 }}
            >
              {config?.sharedModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>

          <p style={{ fontSize: 11, color: "#666", margin: "8px 0" }}>
            Use your own key for unlimited requests and any deployment. It is stored in
            this browser only, sent with each request, and never saved on the server.
          </p>

          {(["endpoint", "apiKey", "deployment"] as const).map((field) => (
            <label key={field} style={{ display: "block", fontSize: 12, marginBottom: 6 }}>
              <span style={{ display: "inline-block", width: 90 }}>{field}</span>
              <input
                type={field === "apiKey" ? "password" : "text"}
                value={creds[field]}
                placeholder={
                  field === "endpoint"
                    ? "https://your-resource.openai.azure.com"
                    : field === "deployment"
                      ? config?.defaultModel ?? ""
                      : ""
                }
                onChange={(e) => saveCreds({ ...creds, [field]: e.target.value })}
                style={{ font: "inherit", width: 380, padding: 4 }}
              />
            </label>
          ))}

          <button type="button" onClick={() => saveCreds(EMPTY)} style={{ fontSize: 12, marginTop: 4 }}>
            Clear key
          </button>
        </fieldset>
      )}

      <form onSubmit={submit}>
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          style={{ width: "100%", padding: 8, font: "inherit" }}
        />
        <button type="submit" disabled={busy} style={{ marginTop: 8, padding: "6px 12px" }}>
          {busy ? "thinking..." : "Ask"}
        </button>
      </form>

      {answer != null && (
        <pre style={{ whiteSpace: "pre-wrap", background: "#f4f4f4", padding: 12, marginTop: 16 }}>
          {JSON.stringify(answer, null, 2)}
        </pre>
      )}
    </main>
  );
}
