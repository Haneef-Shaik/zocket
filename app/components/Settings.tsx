"use client";

/**
 * Credentials and model choice.
 *
 * The security story is the copy: the key is held in this browser, sent with
 * each request, and never stored on the server -- so "Clear key" really is a
 * complete revocation, and saying so is the difference between a user trusting
 * the field and pasting a key they later regret.
 */

import { useEffect, useRef } from "react";

export interface Creds {
  apiKey: string;
  endpoint: string;
  deployment: string;
}

export interface ConfigShape {
  defaultModel: string;
  sharedModels: { id: string; label: string; api: string }[];
  sharedKeyConfigured: boolean;
  trialLimit: number;
}

interface Props {
  config: ConfigShape | null;
  model: string;
  creds: Creds;
  byok: boolean;
  onModel: (id: string) => void;
  onCreds: (next: Creds) => void;
  onClose: () => void;
}

const FIELDS = [
  {
    key: "endpoint" as const,
    label: "Resource endpoint",
    placeholder: "https://your-resource.openai.azure.com",
    type: "text",
  },
  { key: "apiKey" as const, label: "API key", placeholder: "", type: "password" },
  {
    key: "deployment" as const,
    label: "Deployment name (optional)",
    placeholder: "the name you gave it in Azure",
    type: "text",
  },
];

export function Settings({ config, model, creds, byok, onModel, onCreds, onClose }: Props) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" ref={panel} role="dialog" aria-modal="true" aria-label="Settings">
        <div className="dialog-head">
          <h2>Model &amp; credentials</h2>
          <span className="spacer" />
          <button type="button" className="btn quiet" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="dialog-body">
          <div className="field">
            <label htmlFor="model">Model</label>
            <select id="model" value={model} onChange={(e) => onModel(e.target.value)} disabled={byok}>
              {config?.sharedModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
            <span className="help">
              {byok
                ? "Using your own key — set the deployment name below instead."
                : `On the shared key you can pick from this list. ${config?.trialLimit ?? 0} trial requests per device.`}
            </span>
          </div>

          <hr style={{ border: 0, borderTop: "1px solid var(--border)", margin: 0 }} />

          <div>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Use your own Azure key</div>
            <p className="help" style={{ margin: "0 0 12px" }}>
              Unlimited requests and any deployment. The key is stored in this browser only, sent
              with each request, and never written to the server — clearing it here revokes it
              completely.
            </p>

            <div style={{ display: "grid", gap: 12 }}>
              {FIELDS.map((f) => (
                <div className="field" key={f.key}>
                  <label htmlFor={f.key}>{f.label}</label>
                  <input
                    id={f.key}
                    type={f.type}
                    value={creds[f.key]}
                    placeholder={f.placeholder}
                    autoComplete="off"
                    spellCheck={false}
                    onChange={(e) => onCreds({ ...creds, [f.key]: e.target.value })}
                  />
                </div>
              ))}
            </div>

            {creds.apiKey && !creds.endpoint && (
              <p className="help" style={{ color: "var(--status-critical)", marginTop: 10 }}>
                An endpoint is required alongside your key. Without it the request would quietly
                fall back to the shared key and bill someone else.
              </p>
            )}
          </div>
        </div>

        <div className="dialog-foot">
          <button
            type="button"
            className="btn"
            onClick={() => onCreds({ apiKey: "", endpoint: "", deployment: "" })}
          >
            Clear key
          </button>
          <button type="button" className="btn primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
