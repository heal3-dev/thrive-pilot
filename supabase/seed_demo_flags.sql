-- ==========================================================================
-- Seed Script: Demo Flagging Data
--
-- Inserts 30 days of realistic garmin_metrics for 2 existing participants
-- to demonstrate baseline-relative flagging.
--
-- HOW TO RUN:  Paste into Supabase SQL Editor → Run.
--
-- PREREQUISITES:
--   - At least 2 participants must exist in the participants table
--   - Those participants must have pseudonym mappings in participant_pseudonyms
--
-- The script picks the FIRST TWO pseudonym_ids it finds.
-- Participant A = "healthy then declining" → triggers LOW_HRV, HIGH_RHR, LOW_SLEEP
-- Participant B = "chronically stressed"  → triggers HIGH_STRESS, LOW_BODY_BATTERY
-- ==========================================================================

DO $$
DECLARE
  v_pseudo_a uuid;
  v_pseudo_b uuid;
  v_day date;
  v_i int;
  -- Participant A baseline values
  a_hrv numeric;
  a_rhr numeric;
  a_sleep numeric;
  a_score numeric;
  a_stress numeric;
  a_bb numeric;
  -- Participant B baseline values
  b_hrv numeric;
  b_rhr numeric;
  b_sleep numeric;
  b_score numeric;
  b_stress numeric;
  b_bb numeric;
BEGIN
  -- Pick the first two pseudonym_ids
  SELECT pseudonym_id INTO v_pseudo_a
    FROM participant_pseudonyms
    ORDER BY created_at ASC
    LIMIT 1;

  SELECT pseudonym_id INTO v_pseudo_b
    FROM participant_pseudonyms
    ORDER BY created_at ASC
    OFFSET 1
    LIMIT 1;

  IF v_pseudo_a IS NULL OR v_pseudo_b IS NULL THEN
    RAISE EXCEPTION 'Need at least 2 participants with pseudonym mappings';
  END IF;

  -- Delete existing seed data for these pseudonyms (idempotent re-run)
  DELETE FROM garmin_metrics WHERE pseudonym_id IN (v_pseudo_a, v_pseudo_b);

  -- =======================================================================
  -- PARTICIPANT A: "Healthy then declining"
  --
  -- Days 1-20:  Healthy baseline
  --    HRV ~45, RHR ~62, Sleep ~7.5h, Score ~82, Stress ~38, BB ~72
  --
  -- Days 21-27: Gradual decline
  --    HRV drops to ~38, RHR rises to ~70, Sleep drops to ~6h
  --
  -- Days 28-30: Sharp decline (triggers flags)
  --    HRV ~33 (<38.25 = 15% below 45), RHR ~75 (>71.3 = 15% above 62),
  --    Sleep ~4.5h (<6h absolute), Score ~58
  -- =======================================================================

  FOR v_i IN 1..30 LOOP
    v_day := CURRENT_DATE - (31 - v_i);  -- day 1 = 30 days ago, day 30 = yesterday

    IF v_i <= 20 THEN
      -- Healthy baseline period
      a_hrv   := 43 + (random() * 4);           -- 43-47
      a_rhr   := 60 + (random() * 4);           -- 60-64
      a_sleep := 26100 + (random() * 2400);      -- 7.25-7.9h
      a_score := 79 + (random() * 6);           -- 79-85
      a_stress := 35 + (random() * 8);          -- 35-43
      a_bb    := 68 + (random() * 10);           -- 68-78
    ELSIF v_i <= 27 THEN
      -- Gradual decline
      a_hrv   := 42 - ((v_i - 20) * 1.2) + (random() * 2);   -- declining from ~41 to ~33
      a_rhr   := 64 + ((v_i - 20) * 1.3) + (random() * 2);   -- rising from ~65 to ~73
      a_sleep := 25200 - ((v_i - 20) * 900) + (random() * 600); -- declining
      a_score := 78 - ((v_i - 20) * 3) + (random() * 2);     -- declining
      a_stress := 42 + ((v_i - 20) * 4) + (random() * 3);    -- rising
      a_bb    := 65 - ((v_i - 20) * 4) + (random() * 3);     -- declining
    ELSE
      -- Sharp decline (days 28-30) → triggers LOW_HRV, HIGH_RHR, LOW_SLEEP
      a_hrv   := 31 + (random() * 3);           -- 31-34 (below 38.25 = 85% of 45)
      a_rhr   := 74 + (random() * 3);           -- 74-77 (above 71.3 = 115% of 62)
      a_sleep := 15600 + (random() * 1200);      -- 4.3-4.7h (below 6h)
      a_score := 55 + (random() * 5);           -- 55-60 (below 65.6 = 80% of 82)
      a_stress := 55 + (random() * 10);         -- 55-65 (elevated but below 76)
      a_bb    := 38 + (random() * 8);           -- 38-46 (low but above 25)
    END IF;

    INSERT INTO garmin_metrics (
      pseudonym_id, metric_date,
      hrv_last_night_average, hrv_last_night_5_min_high,
      resting_heart_rate, average_stress_level,
      sleep_duration_seconds, sleep_score,
      body_battery_most_recent, body_battery_charged, body_battery_drained,
      steps, active_calories, total_calories,
      updated_at
    ) VALUES (
      v_pseudo_a, v_day,
      round(a_hrv), round(a_hrv + 15 + random() * 10),
      round(a_rhr), round(a_stress),
      round(a_sleep), round(a_score),
      round(a_bb), round(a_bb * 0.6 + random() * 10), round(a_bb * 0.4 + random() * 8),
      5000 + round(random() * 8000), round(200 + random() * 300), round(1800 + random() * 600),
      now()
    )
    ON CONFLICT (pseudonym_id, metric_date) DO UPDATE SET
      hrv_last_night_average = EXCLUDED.hrv_last_night_average,
      hrv_last_night_5_min_high = EXCLUDED.hrv_last_night_5_min_high,
      resting_heart_rate = EXCLUDED.resting_heart_rate,
      average_stress_level = EXCLUDED.average_stress_level,
      sleep_duration_seconds = EXCLUDED.sleep_duration_seconds,
      sleep_score = EXCLUDED.sleep_score,
      body_battery_most_recent = EXCLUDED.body_battery_most_recent,
      body_battery_charged = EXCLUDED.body_battery_charged,
      body_battery_drained = EXCLUDED.body_battery_drained,
      steps = EXCLUDED.steps,
      active_calories = EXCLUDED.active_calories,
      total_calories = EXCLUDED.total_calories,
      updated_at = EXCLUDED.updated_at;
  END LOOP;

  -- =======================================================================
  -- PARTICIPANT B: "Chronically stressed"
  --
  -- Days 1-20:  Moderate baseline
  --    HRV ~38, RHR ~68, Sleep ~6.5h, Score ~72, Stress ~55, BB ~55
  --
  -- Days 21-27: Escalating stress
  --    Stress rises to ~72, BB drops to ~30
  --
  -- Days 28-30: Critical (triggers flags)
  --    Stress ~82 (above 76 for 3 days), BB ~18 (below 25 for 3 days)
  -- =======================================================================

  FOR v_i IN 1..30 LOOP
    v_day := CURRENT_DATE - (31 - v_i);

    IF v_i <= 20 THEN
      -- Moderate baseline
      b_hrv   := 36 + (random() * 4);           -- 36-40
      b_rhr   := 66 + (random() * 4);           -- 66-70
      b_sleep := 22800 + (random() * 2400);      -- 6.3-7h
      b_score := 69 + (random() * 6);           -- 69-75
      b_stress := 52 + (random() * 8);          -- 52-60
      b_bb    := 52 + (random() * 8);           -- 52-60
    ELSIF v_i <= 27 THEN
      -- Escalating stress
      b_hrv   := 35 - ((v_i - 20) * 0.5) + (random() * 2);
      b_rhr   := 68 + ((v_i - 20) * 0.5) + (random() * 2);
      b_sleep := 22800 - ((v_i - 20) * 300) + (random() * 600);
      b_score := 70 - ((v_i - 20) * 1.5) + (random() * 2);
      b_stress := 58 + ((v_i - 20) * 2.5) + (random() * 3); -- rising toward 76
      b_bb    := 50 - ((v_i - 20) * 4) + (random() * 3);    -- declining toward 25
    ELSE
      -- Critical days 28-30 → triggers HIGH_STRESS, LOW_BODY_BATTERY
      b_hrv   := 30 + (random() * 3);           -- 30-33
      b_rhr   := 72 + (random() * 3);           -- 72-75
      b_sleep := 20400 + (random() * 1800);      -- 5.7-6.2h
      b_score := 58 + (random() * 5);           -- 58-63
      b_stress := 78 + (random() * 6);          -- 78-84 (above 76)
      b_bb    := 16 + (random() * 7);           -- 16-23 (below 25)
    END IF;

    INSERT INTO garmin_metrics (
      pseudonym_id, metric_date,
      hrv_last_night_average, hrv_last_night_5_min_high,
      resting_heart_rate, average_stress_level,
      sleep_duration_seconds, sleep_score,
      body_battery_most_recent, body_battery_charged, body_battery_drained,
      steps, active_calories, total_calories,
      updated_at
    ) VALUES (
      v_pseudo_b, v_day,
      round(b_hrv), round(b_hrv + 12 + random() * 8),
      round(b_rhr), round(b_stress),
      round(b_sleep), round(b_score),
      round(b_bb), round(b_bb * 0.5 + random() * 8), round(b_bb * 0.5 + random() * 6),
      4000 + round(random() * 6000), round(150 + random() * 250), round(1600 + random() * 500),
      now()
    )
    ON CONFLICT (pseudonym_id, metric_date) DO UPDATE SET
      hrv_last_night_average = EXCLUDED.hrv_last_night_average,
      hrv_last_night_5_min_high = EXCLUDED.hrv_last_night_5_min_high,
      resting_heart_rate = EXCLUDED.resting_heart_rate,
      average_stress_level = EXCLUDED.average_stress_level,
      sleep_duration_seconds = EXCLUDED.sleep_duration_seconds,
      sleep_score = EXCLUDED.sleep_score,
      body_battery_most_recent = EXCLUDED.body_battery_most_recent,
      body_battery_charged = EXCLUDED.body_battery_charged,
      body_battery_drained = EXCLUDED.body_battery_drained,
      steps = EXCLUDED.steps,
      active_calories = EXCLUDED.active_calories,
      total_calories = EXCLUDED.total_calories,
      updated_at = EXCLUDED.updated_at;
  END LOOP;

  RAISE NOTICE 'Seed data inserted for pseudonym A (%) and B (%)', v_pseudo_a, v_pseudo_b;
END $$;
