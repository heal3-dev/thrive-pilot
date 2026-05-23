import { NextResponse } from "next/server";
import { requireAdmin } from "@/app/api/admin/_utils";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type AdminDbUsageTable = {
  schema_name: string;
  table_name: string;
  total_bytes: number;
  table_bytes: number;
  index_bytes: number;
  toast_bytes: number;
  row_estimate: number | null;
};

type AdminDbUsageJson = {
  captured_at?: string;
  totals?: { database_bytes?: number; public_schema_bytes?: number };
  top_tables?: AdminDbUsageTable[];
  // Back-compat for older function shapes (pre v2)
  db?: { size_bytes?: number };
  public_schema?: { size_bytes?: number };
  tables?: Array<
    | AdminDbUsageTable
    | {
        schema?: string;
        table?: string;
        total_bytes?: number;
        table_bytes?: number;
        index_bytes?: number;
        toast_bytes?: number;
        approx_rows?: number | null;
      }
  >;
  retention_purge?: {
    run_id: string;
    started_at: string;
    finished_at?: string | null;
    retention_raw_days: number;
    retention_logs_days: number;
    rows_deleted: number;
    estimated_deleted_bytes: number;
    reclaimed_bytes: number;
  } | null;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeTable(row: unknown): AdminDbUsageTable | null {
  if (!isObject(row)) return null;
  const schema_name =
    (typeof row.schema_name === "string" && row.schema_name) ||
    (typeof row.schema === "string" && row.schema) ||
    null;
  const table_name =
    (typeof row.table_name === "string" && row.table_name) ||
    (typeof row.table === "string" && row.table) ||
    null;
  if (!schema_name || !table_name) return null;
  const rowEstimateRaw =
    row.row_estimate === undefined ? (row.approx_rows as unknown) : row.row_estimate;
  return {
    schema_name,
    table_name,
    total_bytes: Number(row.total_bytes ?? 0),
    table_bytes: Number(row.table_bytes ?? 0),
    index_bytes: Number(row.index_bytes ?? 0),
    toast_bytes: Number(row.toast_bytes ?? 0),
    row_estimate:
      rowEstimateRaw === null || rowEstimateRaw === undefined ? null : Number(rowEstimateRaw),
  };
}

export async function GET(request: Request) {
  const guard = await requireAdmin(request);
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const limitRaw = url.searchParams.get("limit");
  const limit = Math.max(1, Math.min(200, Number(limitRaw ?? "30") || 30));

  const { data, error } = await guard.admin.rpc("admin_db_usage", { top_n: limit });
  if (error) {
    return NextResponse.json(
      { error: `Failed to load db usage: ${error.message}` },
      { status: 500 }
    );
  }

  const parsed: AdminDbUsageJson | null =
    typeof data === "string"
      ? ((() => {
          try {
            return JSON.parse(data) as AdminDbUsageJson;
          } catch {
            return null;
          }
        })())
      : ((data as AdminDbUsageJson | null) ?? null);

  const totals =
    parsed?.totals && typeof parsed.totals.database_bytes === "number"
      ? parsed.totals
      : parsed?.db?.size_bytes
        ? {
            database_bytes: parsed.db.size_bytes,
            public_schema_bytes: parsed.public_schema?.size_bytes ?? null,
          }
        : null;

  const rawTables = Array.isArray(parsed?.top_tables)
    ? parsed?.top_tables
    : Array.isArray(parsed?.tables)
      ? parsed?.tables
      : null;

  const top_tables = (rawTables ?? [])
    .map(normalizeTable)
    .filter((t): t is AdminDbUsageTable => Boolean(t));

  if (!totals?.database_bytes) {
    return NextResponse.json(
      { error: "Failed to load db usage: unexpected function response" },
      { status: 500 }
    );
  }

  const res = NextResponse.json({
    generated_at: parsed?.captured_at ?? new Date().toISOString(),
    totals: {
      database_bytes: totals.database_bytes,
      public_schema_bytes:
        typeof totals.public_schema_bytes === "number" ? totals.public_schema_bytes : null,
    },
    top_tables,
    retention_purge: parsed?.retention_purge ?? null,
  });
  res.headers.set("Cache-Control", "no-store, max-age=0");
  return res;
}

