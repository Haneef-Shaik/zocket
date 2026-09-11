"use client";

/**
 * One answer, with its work attached.
 *
 * The ordering is the argument: what it understood, what it found, the picture,
 * what was wrong with the data, then the query and the rows. Everything below
 * the finding exists so the number can be checked, so it is present on every
 * answer -- but tabbed rather than stacked, because six open panels is a
 * debugger and the point is a product someone would actually read.
 */

import { useState, type ReactNode } from "react";
import type { Answer } from "@/agent/types";
import { Chart } from "./Chart";
import { Flags } from "./Flags";
import { columnLabel, formatValue, prettyCell, unitFor } from "@/../app/lib/format";

type Tab = "result" | "sql" | "plan";

export function AnswerView({ answer }: { answer: Answer }) {
  const refused = answer.status === "refused";
  const [tab, setTab] = useState<Tab>(refused ? "plan" : "result");

  const tabs: { id: Tab; label: string; available: boolean }[] = [
    { id: "result", label: `Rows (${answer.result?.rows.length ?? 0})`, available: !!answer.result?.rows.length },
    { id: "sql", label: "SQL", available: !!answer.sql },
    { id: "plan", label: "Plan", available: true },
  ];
  const shown = tabs.filter((t) => t.available);

  return (
    <article className="card">
      <div className="card-body">
        <div className="answer-head">
          <span className={`pill ${refused ? "refused" : "answered"}`}>
            <span className="dot" aria-hidden />
            {refused ? "Can't answer" : "Answered"}
          </span>
          {answer.result?.range && (
            <span style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
              {answer.result.range[0]} → {answer.result.range[1]}
            </span>
          )}
        </div>

        <p className="interpretation">
          <b>Interpreted as:</b> {answer.interpretation}
        </p>

        <p className="finding">{answer.finding}</p>
      </div>

      {answer.chart && answer.result && answer.result.rows.length > 0 && (
        <div className="card-body">
          <Chart spec={answer.chart} rows={answer.result.rows} plan={answer.plan} />
        </div>
      )}

      {answer.flags.length > 0 && (
        <div className="card-body">
          <Flags flags={answer.flags} />
        </div>
      )}

      <div className="card-body">
        <div className="tabs" role="tablist">
          {shown.map((t) => (
            <button
              key={t.id}
              role="tab"
              className="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="tabpanel" role="tabpanel">
          {tab === "result" && answer.result && (
            <ResultTable answer={answer} />
          )}
          {tab === "sql" && answer.sql && (
            <>
              <CopyRow text={answer.sql} label="The query that produced these numbers — values are bound, not pasted in." />
              <pre className="code">{highlightSql(answer.sql)}</pre>
            </>
          )}
          {tab === "plan" && (
            <>
              <CopyRow
                text={JSON.stringify(answer.plan, null, 2)}
                label="What the model chose. It never wrote the SQL."
              />
              <pre className="code">{JSON.stringify(answer.plan, null, 2)}</pre>
            </>
          )}
        </div>
      </div>

      <div className="card-body">
        <div className="trace">
          <span>trace {answer.trace.traceId}</span>
          <span>{answer.trace.model}</span>
          <span>
            plan {secs(answer.trace.latencyMs.plan)} · query {secs(answer.trace.latencyMs.query)} ·
            narrate {secs(answer.trace.latencyMs.narrate)} · total {secs(answer.trace.latencyMs.total)}
          </span>
          <span>
            semantic {answer.trace.semanticVersion} · policy {answer.trace.policyVersion} · compiler{" "}
            {answer.trace.compilerVersion}
          </span>
        </div>
      </div>
    </article>
  );
}

/* --------------------------------------------------------------- pieces */

function ResultTable({ answer }: { answer: Answer }) {
  const result = answer.result;
  if (!result) return null;

  const isNumeric = (column: string) => unitFor(column, answer.plan) !== "text";

  return (
    <div className="table-scroll">
      <table className="result">
        <thead>
          <tr>
            {result.columns.map((c) => (
              <th key={c} className={isNumeric(c) ? "num" : undefined}>
                {columnLabel(c, answer.plan)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.rows.map((row, i) => (
            <tr key={i}>
              {result.columns.map((c) => {
                const unit = unitFor(c, answer.plan);
                const raw = row[c] ?? null;
                return unit === "text" ? (
                  <td key={c} className="name">
                    {String(prettyCell(c, raw) ?? "—")}
                  </td>
                ) : (
                  <td key={c} className="num" title={raw === null ? "" : String(raw)}>
                    {formatValue(raw, unit)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CopyRow({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);

  return (
    <div className="copy-row">
      <span className="label">{label}</span>
      <span className="spacer" />
      <button
        type="button"
        className="btn quiet"
        onClick={() => {
          navigator.clipboard?.writeText(text).then(
            () => {
              setDone(true);
              setTimeout(() => setDone(false), 1400);
            },
            () => undefined,
          );
        }}
      >
        {done ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

const secs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`);

const SQL_PATTERN =
  /(--[^\n]*)|('(?:[^']|'')*')|(\$[A-Za-z_][A-Za-z0-9_]*)|\b(SELECT|FROM|WHERE|AND|OR|GROUP\s+BY|ORDER\s+BY|HAVING|LIMIT|AS|WITH|FULL\s+OUTER\s+JOIN|LEFT\s+JOIN|JOIN|ON|CASE|WHEN|THEN|ELSE|END|SUM|COUNT|COALESCE|NULLIF|ANY_VALUE|DISTINCT|BETWEEN|IN|IS|NOT|NULL|ASC|DESC|NULLS\s+LAST|UNION\s+ALL|DATE|date_trunc)\b/gi;

/** Enough highlighting to read as code, built as elements rather than HTML. */
function highlightSql(sql: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;

  for (const m of sql.matchAll(SQL_PATTERN)) {
    const at = m.index ?? 0;
    if (at > last) out.push(sql.slice(last, at));

    const cls = m[1] ? "com" : m[2] ? "str" : m[3] ? "param" : "kw";
    out.push(
      <span className={cls} key={key++}>
        {m[0]}
      </span>,
    );
    last = at + m[0].length;
  }

  out.push(sql.slice(last));
  return out;
}
