import { NextResponse } from "next/server";
import { requireAdmin } from "@/app/api/admin/_utils";

type AdminDbUsageJson = {
  captured_at?: string;
  db?: { size_bytes?: number; size_pretty?: string };
  public_schema?: { size_bytes?: number; size_pretty?: string };
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

  if (!parsed?.db?.size_bytes || !Array.isArray(parsed.tables)) {
    return NextResponse.json(
      { error: "Failed to load db usage: unexpected function response" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    generated_at: parsed.captured_at ?? new Date().toISOString(),
    totals: {
      database_bytes: parsed.db.size_bytes,
      database_pretty: parsed.db.size_pretty ?? null,
      public_schema_bytes: parsed.public_schema?.size_bytes ?? null,
      public_schema_pretty: parsed.public_schema?.size_pretty ?? null,
    },
    top_tables: parsed.tables,
  });
}

