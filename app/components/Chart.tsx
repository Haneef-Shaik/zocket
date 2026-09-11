"use client";

/**
 * The chart is a client leaf, deliberately: Recharts needs the DOM, and keeping
 * it at the edge means a rendering problem here cannot take the answer down
 * with it. The *kind* is already decided -- src/chart/spec.ts chose it from the
 * plan shape -- so this file only draws what it is told, to one set of rules:
 *
 *   * one series gets one colour and no legend (the title names it); two or
 *     more always get a legend, so identity is never carried by colour alone;
 *   * marks are thin, with 4px rounded ends anchored to the baseline and a 2px
 *     surface gap between neighbours;
 *   * grid and axes stay recessive, and every label wears a text token rather
 *     than the series colour;
 *   * a single row is a stat tile, not a one-bar bar chart.
 */

import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { RenderableText } from "recharts/types/component/Text";
import type { ChartSpec } from "@/chart/spec";
import type { ResultRow } from "@/agent/types";
import type { Plan } from "@/plan/schema";
import { columnLabel, formatCompact, formatValue, prettyCell, unitFor } from "@/../app/lib/format";

const SERIES_CLASS = ["series-1", "series-2"] as const;
const BAR_MAX = 24;

interface Props {
  spec: ChartSpec;
  rows: readonly ResultRow[];
  plan: Plan;
}

export function Chart({ spec, rows, plan }: Props) {
  if (rows.length === 0 || spec.y.length === 0) return null;

  // A single row is a number, not a chart. A one-bar bar chart asks the reader
  // to compare a length against nothing.
  if (spec.kind === "stat" || rows.length === 1) {
    return <StatTiles keys={spec.y} row={rows[0]} plan={plan} />;
  }

  const unit = unitFor(spec.y[0] ?? "", plan);
  const xKey = spec.x ?? "label";
  const data = rows.map((row) => ({ ...row, __label: prettyCell(xKey, row[xKey] ?? null) }));
  const axis = { tick: { fontSize: 11 }, tickLine: false, axisLine: false } as const;

  const legend =
    spec.y.length > 1 ? (
      <div className="legend">
        {spec.y.map((key, i) => (
          <span key={key} className={`legend-item ${SERIES_CLASS[i % 2]}`}>
            <span className="legend-swatch" />
            <span style={{ color: "var(--text-secondary)" }}>{columnLabel(key, plan)}</span>
          </span>
        ))}
      </div>
    ) : null;

  const tooltip = (
    <Tooltip
      cursor={{ fill: "var(--surface-2)", opacity: 0.6 }}
      content={(props) => (
        <ChartTooltip active={props.active} label={props.label} payload={props.payload} plan={plan} />
      )}
    />
  );

  if (spec.kind === "line") {
    return (
      <div className="chart">
        {legend}
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="__label" {...axis} minTickGap={24} />
            <YAxis {...axis} width={56} tickFormatter={(v: number) => formatCompact(v, unit)} />
            {tooltip}
            {spec.y.map((key, i) => (
              <Line
                key={key}
                className={SERIES_CLASS[i % 2]}
                isAnimationActive={false}
                type="monotone"
                dataKey={key}
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--surface-1)" }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    );
  }

  if (spec.kind === "hbar") {
    return (
      <div className="chart">
        {legend}
        <ResponsiveContainer width="100%" height={Math.max(170, rows.length * 32 + 40)}>
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 56, bottom: 0, left: 0 }} barGap={2}>
            <CartesianGrid horizontal={false} />
            <XAxis type="number" {...axis} tickFormatter={(v: number) => formatCompact(v, unit)} />
            <YAxis type="category" dataKey="__label" {...axis} width={150} />
            {tooltip}
            {spec.y.map((key, i) => (
              <Bar
                key={key}
                className={SERIES_CLASS[i % 2]}
                isAnimationActive={false}
                dataKey={key}
                fill="currentColor"
                radius={[0, 4, 4, 0]}
                maxBarSize={BAR_MAX}
              >
                {spec.y.length === 1 && (
                  <LabelList
                    dataKey={key}
                    position="right"
                    formatter={(v: RenderableText) => formatValue(typeof v === "number" ? v : null, unit)}
                  />
                )}
              </Bar>
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  }

  // bar and grouped_bar
  return (
    <div className="chart">
      {legend}
      <ResponsiveContainer width="100%" height={270}>
        <BarChart data={data} margin={{ top: 14, right: 12, bottom: 0, left: 0 }} barGap={2}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="__label" {...axis} interval={0} />
          <YAxis {...axis} width={56} tickFormatter={(v: number) => formatCompact(v, unit)} />
          {tooltip}
          {spec.y.map((key, i) => (
            <Bar
              key={key}
              className={SERIES_CLASS[i % 2]}
              isAnimationActive={false}
              dataKey={key}
              fill="currentColor"
              radius={[4, 4, 0, 0]}
              maxBarSize={BAR_MAX}
            >
              {spec.y.length === 1 && rows.length <= 8 && (
                <LabelList
                  dataKey={key}
                  position="top"
                  formatter={(v: RenderableText) => (typeof v === "number" ? formatCompact(v, unit) : "")}
                />
              )}
            </Bar>
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/* --------------------------------------------------------------- pieces */

function StatTiles({
  keys,
  row,
  plan,
}: {
  keys: readonly string[];
  row: ResultRow | undefined;
  plan: Plan;
}) {
  if (!row) return null;
  // The headline first, then the components that make it checkable.
  const shown = keys.slice(0, 4);

  return (
    <div className="stats">
      {shown.map((key) => (
        <div className="stat" key={key}>
          <div className="stat-label">{columnLabel(key, plan)}</div>
          <div className="stat-value">{formatValue(row[key] ?? null, unitFor(key, plan))}</div>
        </div>
      ))}
    </div>
  );
}

/** Loosely typed on purpose: Recharts hands the content renderer a readonly,
 *  widely-typed payload, and narrowing it here is cheaper than fighting it. */
interface TooltipProps {
  active?: boolean;
  label?: unknown;
  payload?: readonly { dataKey?: unknown; value?: unknown }[];
  plan: Plan;
}

function ChartTooltip({ active, label, payload, plan }: TooltipProps) {
  if (!active || !payload?.length) return null;

  return (
    <div className="tooltip">
      <div className="tooltip-title">{String(label ?? "")}</div>
      {payload.map((entry, i) => {
        const key = String(entry.dataKey ?? "");
        return (
          <div className="tooltip-row" key={key}>
            <span className={SERIES_CLASS[i % 2]} style={{ display: "inline-flex" }}>
              <span className="legend-swatch" />
            </span>
            <span>{columnLabel(key, plan)}</span>
            <span className="tooltip-value">
              {formatValue(typeof entry.value === "number" ? entry.value : null, unitFor(key, plan))}
            </span>
          </div>
        );
      })}
    </div>
  );
}
