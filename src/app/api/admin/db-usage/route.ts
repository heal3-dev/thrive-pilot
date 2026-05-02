import { NextResponse } from "next/server";
import { requireAdmin } from "@/app/api/admin/_utils";

type AdminDbUsageJson = {
  captured_at?: string;
  db?: {
    size_bytes?: number;
    size_pretty?: string;
    growth_bytes_7d?: number | null;
    growth_bytes_per_day_7d?: number | null;
  };
  public_schema?: { size_bytes?: number; size_pretty?: string };
  totals?: {
    database_bytes?: number;
    public_schema_bytes?: number;
    database_growth_bytes_7d?: number | null;
    database_growth_bytes_per_day_7d?: number | null;
  };
  tables?: Array<{
    schema_name: string;
    table_name: string;
    total_bytes: number;
    total_pretty: string;
    table_bytes: number;
    table_pretty: string;
    index_bytes: number;
    index_pretty: string;
    toast_bytes: number;
    toast_pretty: string;
    row_estimate: number | null;
    growth_bytes_7d?: number | null;
    growth_bytes_per_day_7d?: number | null;
  }>;
  top_tables?: Array<{
    schema_name: string;
    table_name: string;
    total_bytes: number;
    total_pretty?: string;
    table_bytes?: number;
    table_pretty?: string;
    index_bytes?: number;
    index_pretty?: string;
    toast_bytes?: number;
    toast_pretty?: string;
    row_estimate?: number | null;
    growth_bytes_7d?: number | null;
    growth_bytes_per_day_7d?: number | null;
  }>;
};

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

  const dbBytes =
    typeof parsed?.db?.size_bytes === "number"
      ? parsed.db.size_bytes
      : typeof parsed?.totals?.database_bytes === "number"
        ? parsed.totals.database_bytes
        : null;

  const publicBytes =
    typeof parsed?.public_schema?.size_bytes === "number"
      ? parsed.public_schema.size_bytes
      : typeof parsed?.totals?.public_schema_bytes === "number"
        ? parsed.totals.public_schema_bytes
        : null;

  const topTablesRaw = Array.isArray(parsed?.tables)
    ? parsed!.tables
    : Array.isArray(parsed?.top_tables)
      ? parsed!.top_tables
      : null;

  if (!dbBytes || !topTablesRaw) {
    return NextResponse.json(
      { error: "Failed to load db usage: unexpected function response" },
      { status: 500 }
    );
  }

  const dbGrowthBytes7d =
    typeof parsed?.totals?.database_growth_bytes_7d === "number" || parsed?.totals?.database_growth_bytes_7d === null
      ? (parsed?.totals?.database_growth_bytes_7d ?? null)
      : typeof parsed?.db?.growth_bytes_7d === "number" || parsed?.db?.growth_bytes_7d === null
        ? (parsed?.db?.growth_bytes_7d ?? null)
        : null;

  const dbGrowthBytesPerDay7d =
    typeof parsed?.totals?.database_growth_bytes_per_day_7d === "number" ||
    parsed?.totals?.database_growth_bytes_per_day_7d === null
      ? (parsed?.totals?.database_growth_bytes_per_day_7d ?? null)
      : typeof parsed?.db?.growth_bytes_per_day_7d === "number" || parsed?.db?.growth_bytes_per_day_7d === null
        ? (parsed?.db?.growth_bytes_per_day_7d ?? null)
        : null;

  return NextResponse.json({
    generated_at: parsed?.captured_at ?? new Date().toISOString(),
    totals: {
      database_bytes: dbBytes,
      database_pretty: parsed?.db?.size_pretty ?? null,
      public_schema_bytes: publicBytes,
      public_schema_pretty: parsed?.public_schema?.size_pretty ?? null,
      database_growth_bytes_7d: dbGrowthBytes7d,
      database_growth_bytes_per_day_7d: dbGrowthBytesPerDay7d,
    },
    top_tables: topTablesRaw,
  });
}

