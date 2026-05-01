import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import DbUsageClient from "./db-usage-client";

export default async function DbUsagePage() {
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

  return (
    <div className="h-full min-h-0 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex flex-col">
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-clash text-3xl font-bold text-slate-900">DB Usage</h1>
          <p className="mt-2 text-base text-slate-500">
            Monitor total database size and identify the largest tables.
          </p>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">
        <DbUsageClient />
      </div>
    </div>
  );
}

