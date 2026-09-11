"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Answer } from "@/agent/types";
import { AnswerView } from "./components/AnswerView";
import { Settings, type ConfigShape, type Creds } from "./components/Settings";

/**
 * The whole product is one question box and one answer.
 *
 * The suggestions carry their real text rather than "Q1..Q5" because they are
 * the only thing telling a first-time reader what this can be asked — including
 * the one that is deliberately refused, which is easier to demonstrate than to
 * explain.
 */

const KEY_STORE = "da.azure.credentials";
const THEME_STORE = "da.theme";
const EMPTY: Creds = { apiKey: "", endpoint: "", deployment: "" };

interface Config extends ConfigShape {
  quota: { used: number; remaining: number | null; limit: number | null };
}

type Payload = Partial<Answer> & { error?: string; code?: string; quota?: Config["quota"] };

const SUGGESTIONS = [
  "What did we spend by channel over the last eight weeks?",
  "Which campaign generated the most revenue this quarter?",
  "Conversions look like they fell off a cliff on the most recent day. What happened?",
  "Which campaign should we turn off?",
  "How did last week compare to the week before?",
  "Are any campaigns hitting their budget caps?",
  "How does our spend compare to our competitors'?",
];

const SHORT = [
  "Spend by channel",
  "Top campaign this quarter",
  "Why did conversions drop?",
  "What should we turn off?",
  "Last week vs the week before",
  "Are we hitting budget caps?",
  "How do we compare to competitors?",
];

export default function Page() {
  const [config, setConfig] = useState<Config | null>(null);
  const [question, setQuestion] = useState("");
  const [model, setModel] = useState("");
  const [creds, setCreds] = useState<Creds>(EMPTY);
  const [showSettings, setShowSettings] = useState(false);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [theme, setTheme] = useState<"light" | "dark" | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);

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
      const t = localStorage.getItem(THEME_STORE);
      if (t === "dark" || t === "light") setTheme(t);
    } catch {
      /* private mode, or a corrupt entry: fall back to the shared key */
    }
  }, []);

  useEffect(() => {
    if (!busy) return;
    const started = Date.now();
    setElapsed(0);
    const id = setInterval(() => setElapsed(Math.round((Date.now() - started) / 100) / 10), 100);
    return () => clearInterval(id);
  }, [busy]);

  const byok = creds.apiKey.trim() !== "" && creds.endpoint.trim() !== "";

  function saveCreds(next: Creds) {
    setCreds(next);
    try {
      if (next.apiKey || next.endpoint) localStorage.setItem(KEY_STORE, JSON.stringify(next));
      else localStorage.removeItem(KEY_STORE);
    } catch {
      /* storage unavailable; the key still works for this session */
    }
  }

  function toggleTheme() {
    const next = (theme ?? preferredTheme()) === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(THEME_STORE, next);
    } catch {
      /* nothing to do; the toggle still works for this page load */
    }
  }

  const ask = useCallback(
    async (q: string) => {
      const trimmed = q.trim();
      if (!trimmed || busy) return;

      setBusy(true);
      setError(null);
      setAnswer(null);

      try {
        const credentials: Record<string, string> = {};
        if (byok) {
          credentials.apiKey = creds.apiKey.trim();
          credentials.endpoint = creds.endpoint.trim();
          if (creds.deployment.trim()) credentials.deployment = creds.deployment.trim();
        }
        if (model && !byok) credentials.model = model;

        const res = await fetch("/api/ask", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            question: trimmed,
            credentials: Object.keys(credentials).length ? credentials : undefined,
          }),
        });

        const json: Payload = await res.json();
        if (json.quota && config) setConfig({ ...config, quota: json.quota });

        if (!res.ok || json.error) {
          setError({ message: json.error ?? `Request failed (${res.status}).`, code: json.code });
        } else {
          setAnswer(json as Answer);
        }
      } catch (err) {
        setError({ message: err instanceof Error ? err.message : "Request failed." });
      } finally {
        setBusy(false);
      }
    },
    [busy, byok, creds, model, config],
  );

  const first = !answer && !error && !busy;
  const quotaLeft = config?.quota.remaining;

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden>
            ◆
          </span>
          <span className="brand-text">Dashboard Agent</span>
        </div>
        <span className="spacer" />

        <span className="chip-button" style={{ cursor: "default" }} title={byok ? "Using your own Azure key" : "Shared trial key"}>
          {byok ? "your key" : `${quotaLeft ?? "–"} / ${config?.trialLimit ?? "–"} left`}
        </span>

        <button type="button" className="chip-button" onClick={toggleTheme} aria-label="Toggle theme">
          {(theme ?? "light") === "dark" ? "☾" : "☀"}
        </button>

        <button type="button" className="chip-button" onClick={() => setShowSettings(true)}>
          Settings
        </button>
      </header>

      {first && (
        <div className="hero">
          <h1>Ask about your ad performance.</h1>
          <p>
            Every answer shows the plan it ran, the SQL it ran, the rows that came back, and what
            was wrong with the data underneath — so you can check it rather than trust it.
          </p>
        </div>
      )}

      <div className="askbox">
        <textarea
          ref={box}
          rows={1}
          value={question}
          placeholder="Ask about spend, revenue, campaigns…"
          onChange={(e) => {
            setQuestion(e.target.value);
            e.target.style.height = "auto";
            e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void ask(question);
            }
          }}
        />
        <button
          type="button"
          className="send"
          disabled={busy || question.trim() === ""}
          onClick={() => void ask(question)}
          aria-label="Ask"
        >
          {busy ? <span className="spinner" style={{ borderTopColor: "currentColor" }} /> : "↑"}
        </button>
      </div>

      <p className="hint">Enter to ask · Shift + Enter for a new line</p>

      <div className="suggestions">
        {SUGGESTIONS.map((s, i) => (
          <button
            key={s}
            type="button"
            className="suggestion"
            disabled={busy}
            title={s}
            onClick={() => {
              setQuestion(s);
              void ask(s);
            }}
          >
            {SHORT[i]}
          </button>
        ))}
      </div>

      {busy && (
        <div className="card">
          <div className="card-body">
            <div className="working">
              <span className="spinner" />
              <span>Working… {elapsed.toFixed(1)}s</span>
            </div>
            <div className="stage-list">
              <span className="stage">plan the query</span>
              <span className="stage">validate &amp; compile</span>
              <span className="stage">run it</span>
              <span className="stage">check every figure</span>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="notice">
          <span className="bar" aria-hidden />
          <span>
            <b>{error.code === "quota_exhausted" ? "Trial limit reached" : "That request didn’t go through"}</b>
            {error.message}
            {error.code === "quota_exhausted" && (
              <>
                {" "}
                <button type="button" className="btn quiet" onClick={() => setShowSettings(true)}>
                  Use your own key
                </button>
              </>
            )}
          </span>
        </div>
      )}

      {answer && <AnswerView answer={answer} />}

      {showSettings && (
        <Settings
          config={config}
          model={model}
          creds={creds}
          byok={byok}
          onModel={setModel}
          onCreds={saveCreds}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}

function preferredTheme(): "light" | "dark" {
  return typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}
