"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { BackButton } from "@/components/ui/back-button";
import { Input } from "@/components/ui/input";

type DbUsageTotals = {
  database_bytes: number;
  public_schema_bytes: number;
};

type DbUsageTable = {
  schema_name: string;
  table_name: string;
  total_bytes: number;
  table_bytes: number;
  index_bytes: number;
  toast_bytes: number;
  row_estimate: number;
};

type DbUsageResponse = {
  generated_at: string;
  totals: DbUsageTotals;
  top_tables: DbUsageTable[];
};

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes)) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  const decimals = i <= 1 ? 0 : i === 2 ? 1 : 2;
  return `${v.toFixed(decimals)} ${units[i]}`;
}

function formatInt(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat().format(Math.round(n));
}

export default function DbUsageClient() {
  const router = useRouter();
  const [limit, setLimit] = useState("25");
  const [data, setData] = useState<DbUsageResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const effectiveLimit = useMemo(() => {
    const n = Number(limit);
    if (!Number.isFinite(n) || n <= 0) return 25;
    return Math.min(200, Math.max(1, Math.floor(n)));
  }, [limit]);

  const fetchUsage = useCallback(
    async (opts?: { refresh?: boolean }) => {
      setError(null);
      if (opts?.refresh) setIsRefreshing(true);
      else setIsLoading(true);

      try {
        const { data: sessionData, error: sessionErr } = await supabase.auth.getSession();
        if (sessionErr) throw sessionErr;
        const token = sessionData?.session?.access_token ?? null;
        if (!token) throw new Error("Authentication required");

        const res = await fetch(`/api/admin/db-usage?limit=${effectiveLimit}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error((json && json.error) || `Request failed (${res.status})`);
        }
        setData(json as DbUsageResponse);
      } catch (e) {
        setData(null);
        setError(e instanceof Error ? e.message : "Failed to load DB usage");
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [effectiveLimit],
  );

  useEffect(() => {
    void fetchUsage();
  }, [fetchUsage]);

  return (
    <div className="w-full space-y-6">
      <div className="flex items-center justify-end gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm text-slate-600">Top tables</span>
          <Input
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
            className="w-20 h-10"
            inputMode="numeric"
          />
        </div>
        <Button
          onClick={() => fetchUsage({ refresh: true })}
          disabled={isLoading || isRefreshing}
          className="bg-teal-500 hover:bg-teal-600 text-white"
        >
          {isRefreshing ? "Refreshing…" : "Refresh"}
        </Button>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-red-50 border-2 border-red-200">
          <p className="text-sm font-semibold text-red-700">{error}</p>
        </div>
      )}

      <div className="flex items-center">
        <BackButton
          onClick={() => {
            if (typeof window !== "undefined" && window.history.length > 1) {
              router.back();
            } else {
              router.push("/dashboard");
            }
          }}
        />
      </div>

      {isLoading ? (
        <div className="bg-white rounded-2xl border-2 border-slate-100 p-8 text-slate-500">
          Loading DB usage…
        </div>
      ) : data ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="bg-white rounded-2xl border-2 border-slate-100 p-5">
              <p className="text-sm font-semibold text-slate-700">Total database size</p>
              <p className="mt-2 text-2xl font-bold text-slate-900">
                {formatBytes(data.totals.database_bytes)}
              </p>
            </div>
            <div className="bg-white rounded-2xl border-2 border-slate-100 p-5">
              <p className="text-sm font-semibold text-slate-700">Public schema size</p>
              <p className="mt-2 text-2xl font-bold text-slate-900">
                {formatBytes(data.totals.public_schema_bytes)}
              </p>
            </div>
          </div>

          <div className="bg-white rounded-2xl border-2 border-slate-100 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100">
              <h2 className="text-sm font-bold text-slate-800">Largest tables</h2>
            </div>
            <div className="overflow-auto px-5">
              <table className="w-full table-fixed border-collapse border-spacing-0">
                <colgroup>
                  <col className="w-[28%]" />
                  <col className="w-[18%]" />
                  <col className="w-[18%]" />
                  <col className="w-[18%]" />
                  <col className="w-[18%]" />
                </colgroup>
                <thead className="bg-slate-50 border-b border-slate-100">
                  <tr>
                    <th className="text-left py-3 pr-4 text-xs font-bold text-slate-700 uppercase tracking-wider">
                      Table
                    </th>
                    <th className="text-right py-3 pl-4 text-xs font-bold text-slate-700 uppercase tracking-wider">
                      Total
                    </th>
                    <th className="text-right py-3 pl-4 text-xs font-bold text-slate-700 uppercase tracking-wider">
                      Table
                    </th>
                    <th className="text-right py-3 pl-4 text-xs font-bold text-slate-700 uppercase tracking-wider">
                      Indexes
                    </th>
                    <th className="text-right py-3 pl-4 text-xs font-bold text-slate-700 uppercase tracking-wider">
                      Rows (est.)
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.top_tables.map((t) => (
                    <tr key={`${t.schema_name}.${t.table_name}`} className="hover:bg-slate-50">
                      <td className="py-3 pr-4">
                        <p className="font-semibold text-slate-900 break-words">
                          {t.schema_name}.{t.table_name}
                        </p>
                      </td>
                      <td className="py-3 pl-4 text-right font-semibold text-slate-900">
                        {formatBytes(t.total_bytes)}
                      </td>
                      <td className="py-3 pl-4 text-right text-slate-700">
                        {formatBytes(t.table_bytes)}
                      </td>
                      <td className="py-3 pl-4 text-right text-slate-700">
                        {formatBytes(t.index_bytes)}
                      </td>
                      <td className="py-3 pl-4 text-right text-slate-700">
                        {formatInt(t.row_estimate)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : (
        <div className="bg-white rounded-2xl border-2 border-slate-100 p-8 text-slate-500">
          No data.
        </div>
      )}
    </div>
  );
}

