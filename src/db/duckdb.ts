/**
 * DuckDB connection and canonical-model bootstrap.
 *
 * In-process, in-memory, rebuilt from the CSVs at boot. That is the whole
 * "warehouse" for the MVP -- the interface it presents (a `fact` view plus a
 * coverage window) is the part meant to survive contact with a real one.
 */

import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";
import { readFile } from "node:fs/promises";
import path from "node:path";

export interface Coverage {
  readonly firstDate: string;
  readonly lastDate: string;
  readonly rowCount: number;
}

let connPromise: Promise<DuckDBConnection> | null = null;
let coverage: Coverage | null = null;

const DATA_DIR = process.env.DASHBOARD_AGENT_DATA ?? path.join(process.cwd(), "data");
const VIEWS_SQL = path.join(process.cwd(), "src", "sql", "views.sql");

async function bootstrap(): Promise<DuckDBConnection> {
  const instance = await DuckDBInstance.create(":memory:");
  const conn = await instance.connect();

  const ddl = await readFile(VIEWS_SQL, "utf8");
  const hydrated = ddl
    .replaceAll("$perf_path", quote(path.join(DATA_DIR, "ad_performance_daily.csv")))
    .replaceAll("$campaigns_path", quote(path.join(DATA_DIR, "campaigns.csv")))
    .replaceAll("$creatives_path", quote(path.join(DATA_DIR, "creatives.csv")))
    .replaceAll("$fx_path", quote(path.join(DATA_DIR, "fx_rates.csv")));

  // The DDL is many statements; run() takes one and runUntilLast() skips the
  // last. Extract and run each so a failure names the statement that failed.
  const statements = await conn.extractStatements(hydrated);
  for (let i = 0; i < statements.count; i++) {
    const prepared = await statements.prepare(i);
    await prepared.run();
  }

  const rows = await query(conn, "SELECT * FROM coverage");
  const c = rows[0];
  if (!c || c.first_date == null) {
    throw new Error(`No rows loaded from ${DATA_DIR} -- check the data directory.`);
  }
  coverage = {
    firstDate: String(c.first_date),
    lastDate: String(c.last_date),
    rowCount: Number(c.row_count),
  };

  return conn;
}

function quote(p: string): string {
  return `'${p.replaceAll("'", "''")}'`;
}

export function getConnection(): Promise<DuckDBConnection> {
  connPromise ??= bootstrap();
  return connPromise;
}

/** Coverage is only known after bootstrap; callers must await getConnection first. */
export async function getCoverage(): Promise<Coverage> {
  await getConnection();
  if (!coverage) throw new Error("coverage unavailable after bootstrap");
  return coverage;
}

export type Row = Record<string, unknown>;

async function query(conn: DuckDBConnection, sql: string): Promise<Row[]> {
  const reader = await conn.runAndReadAll(sql);
  return reader.getRowObjects() as Row[];
}

/**
 * Read-only query entry point. Every caller is the compiler -- no hand-written
 * SQL reaches this from a request path.
 */
export async function run(sql: string): Promise<Row[]> {
  const conn = await getConnection();
  return query(conn, sql);
}

/** Test/CLI helper: drop the cached connection so the next call re-ingests. */
export function reset(): void {
  connPromise = null;
  coverage = null;
}
