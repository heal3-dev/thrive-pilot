"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { BackButton } from "@/components/ui/back-button";
import { Button } from "@/components/ui/button";

export default function MonthlyReportDemoClient({ html }: { html: string }) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);

  const srcDoc = useMemo(() => html, [html]);

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <BackButton onClick={() => router.push("/dashboard/monthly-reports")} className="border-slate-300" />
        <Button
          variant="outline"
          size="sm"
          className="border-slate-300"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(html);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1200);
            } catch {
              // ignore
            }
          }}
        >
          {copied ? "Copied HTML" : "Copy HTML"}
        </Button>
      </div>

      <div className="flex-1 min-h-0 overflow-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        <iframe
          title="Monthly report template demo"
          sandbox=""
          style={{ width: "100%", height: "100%", minHeight: 900, background: "white" }}
          srcDoc={srcDoc}
        />
      </div>
    </div>
  );
}
