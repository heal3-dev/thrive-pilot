import { getSupabaseAdmin } from '@/lib/supabase';

export type GarminHealthSource =
  | 'webhook-dailies'
  | 'webhook-sleeps'
  | 'webhook-hrv'
  | 'webhook-stress';

/**
 * Upsert a "last successful Garmin ingestion" marker for a pseudonym.
 *
 * This is intentionally best-effort: ingestion should not fail if health
 * tracking fails.
 */
export async function markGarminIngestionSuccess(params: {
  pseudonymId: string;
  calendarDate: string; // YYYY-MM-DD
  source: GarminHealthSource;
}): Promise<void> {
  try {
    const supabase = getSupabaseAdmin();

    await supabase.from('garmin_connection_health').upsert(
      {
        pseudonym_id: params.pseudonymId,
        last_success_at: new Date().toISOString(),
        last_calendar_date: params.calendarDate,
        last_source: params.source,
      },
      { onConflict: 'pseudonym_id' },
    );
  } catch (err) {
    // Best-effort only; do not throw
    console.error('[GARMIN_HEALTH] Failed to mark ingestion success:', err);
  }
}

export async function markGarminAlertSent(params: {
  pseudonymId: string;
  alertType: 'reconnect' | 'nudge';
}): Promise<void> {
  const supabase = getSupabaseAdmin();
  await supabase.from('garmin_connection_health').upsert(
    {
      pseudonym_id: params.pseudonymId,
      last_alert_sent_at: new Date().toISOString(),
      last_alert_type: params.alertType,
    },
    { onConflict: 'pseudonym_id' },
  );
}

