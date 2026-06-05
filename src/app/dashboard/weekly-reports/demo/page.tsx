import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { buildWeeklyReportDemoHtml } from "@/lib/weekly-reports/demo";
import WeeklyReportDemoClient from "./weekly-report-demo-client";

export default async function WeeklyReportDemoPage() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;

  if (!user) {
    redirect("/");
  }

  const { data: mentor } = await supabase
    .from("mentors")
    .select("id, role")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!mentor?.id || mentor.role !== "admin") {
    redirect("/dashboard");
  }

  const html = buildWeeklyReportDemoHtml();

  return (
    <div className="h-full min-h-0 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-clash text-3xl font-bold text-slate-900">Weekly Report Template Demo</h1>
          <p className="mt-2 text-base text-slate-500">
            A static preview of the current template with sample data.
          </p>
        </div>
      </div>
      <WeeklyReportDemoClient html={html} />
    </div>
  );
}

