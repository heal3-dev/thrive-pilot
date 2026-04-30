import { NextResponse } from "next/server";
import { requireAdmin } from "@/app/api/admin/_utils";

type DbUsageRow = {
  schema_name: string;
  table_name: string;
  row_estimate: number | null;
  total_bytes: number;
  total_pretty: string;
  index_bytes: number;
  index_pretty: string;
  toast_bytes: number;
  toast_pretty: string;
  table_bytes: number;
  table_pretty: string;
};

export async function GET(request: Request) {
  const guard = await requireAdmin(request);
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const limitRaw = url.searchParams.get("limit");
  const limit = Math.max(1, Math.min(200, Number(limitRaw ?? "30") || 30));

  const { data, error } = await guard.admin.rpc("admin_db_usage", { p_limit: limit });
  if (error) {
    return NextResponse.json(
      { error: `Failed to load db usage: ${error.message}` },
      { status: 500 }
    );
  }

  const tables = ((data ?? []) as DbUsageRow[]).map((r) => ({
    schema: r.schema_name,
    table: r.table_name,
    rows_estimate: r.row_estimate,
    bytes: {
      total: r.total_bytes,
      table: r.table_bytes,
      index: r.index_bytes,
      toast: r.toast_bytes,
    },
    pretty: {
      total: r.total_pretty,
      table: r.table_pretty,
      index: r.index_pretty,
      toast: r.toast_pretty,
    },
  }));

  const totalBytes = tables.reduce((sum, t) => sum + (t.bytes.total ?? 0), 0);

  return NextResponse.json({
    generated_at: new Date().toISOString(),
    limit,
    total_bytes_top_tables: totalBytes,
    tables,
  });
}

