"use client";

/**
 * Data-quality flags, ranked by whether they change the answer.
 *
 * The naive rendering is a bullet list of every flag, and on a typical question
 * that is twelve long sentences -- which trains the reader to skip all of them,
 * including the one that matters. So warnings are always open, notes are folded
 * behind a count, and severity is carried by an icon and a word as well as a
 * colour.
 */

import { useState } from "react";
import type { Flag, Severity } from "@/verify/flags";

const RANK: Record<Severity, number> = { critical: 0, warn: 1, info: 2 };

const NOUN: Record<Severity, [string, string]> = {
  critical: ["problem", "problems"],
  warn: ["warning", "warnings"],
  info: ["note", "notes"],
};

const GLYPH: Record<Severity, string> = { critical: "!", warn: "!", info: "i" };

export function Flags({ flags }: { flags: readonly Flag[] }) {
  const [showNotes, setShowNotes] = useState(false);
  if (flags.length === 0) return null;

  const sorted = [...flags].sort((a, b) => RANK[a.severity] - RANK[b.severity]);
  const loud = sorted.filter((f) => f.severity !== "info");
  const notes = sorted.filter((f) => f.severity === "info");

  const counts = (["critical", "warn", "info"] as const)
    .map((severity) => ({ severity, n: sorted.filter((f) => f.severity === severity).length }))
    .filter((c) => c.n > 0);

  return (
    <section>
      <div className="flagbar">
        <strong style={{ fontSize: 13, marginRight: 2 }}>Data quality</strong>
        {counts.map(({ severity, n }) => (
          <span className="flag-chip" key={severity}>
            <span className={`flag-dot ${severity}`} aria-hidden />
            {n} {NOUN[severity][n === 1 ? 0 : 1]}
          </span>
        ))}
        <span className="spacer" />
        {notes.length > 0 && (
          <button type="button" className="btn quiet" onClick={() => setShowNotes((v) => !v)}>
            {showNotes ? "Hide notes" : `Show ${notes.length} notes`}
          </button>
        )}
      </div>

      {loud.length > 0 && <FlagRows flags={loud} />}
      {showNotes && notes.length > 0 && <FlagRows flags={notes} />}

      {loud.length === 0 && !showNotes && (
        <p style={{ margin: "12px 0 0", fontSize: 13.5, color: "var(--text-secondary)" }}>
          Nothing in this window changes how the numbers should be read.
        </p>
      )}
    </section>
  );
}

function FlagRows({ flags }: { flags: readonly Flag[] }) {
  return (
    <ul className="flag-list">
      {flags.map((flag) => (
        <li className="flag-row" key={flag.code}>
          <span className={`flag-dot ${flag.severity}`} aria-hidden>
            <span className="sr-only">{GLYPH[flag.severity]}</span>
          </span>
          <span>
            <span className="flag-code">{flag.code}</span>{" "}
            <span className="flag-count">· {flag.count} rows</span>
            <br />
            <span className="flag-msg">{flag.message}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
