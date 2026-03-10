# Thrive Pilot: Garmin Health Data Integration Report

**Prepared for:** Stakeholder meeting on flagging rule definitions
**Date:** February 18, 2026

---

## 1. Executive Summary

The Thrive Pilot system ingests daily health metrics from participants' Garmin wearable devices via the Garmin Health API. Data flows automatically through four dedicated webhook endpoints, is pseudonymized for PIPEDA compliance, and is stored in a unified daily metrics table. The admin dashboard displays 5 core health metrics that can be used to define flagging rules for early intervention.

---

## 2. Data We Currently Collect

### 2.1 Five Core Pilot Metrics (displayed in admin UI)


| Metric                 | Source Endpoint           | What It Measures                                         | Example Value  | Range                        |
| ---------------------- | ------------------------- | -------------------------------------------------------- | -------------- | ---------------------------- |
| **Sleep**              | HEALTH - Sleeps           | Total sleep duration + quality score                     | 7.5h (82)      | 0-24h, score 0-100           |
| **Stress**             | HEALTH - Dailies          | Average daily stress level                               | 43             | 0-100 (higher = more stress) |
| **HRV**                | HEALTH - HRV Summary      | Heart rate variability (last night average + 5-min peak) | 45 (peak 67)   | Typically 20-100ms           |
| **Resting Heart Rate** | HEALTH - Dailies          | Resting heart rate in BPM                                | 54             | Typically 40-100 bpm         |
| **Body Battery**       | HEALTH - Dailies + Stress | Energy score (0-100) + daily charged/drained             | 46 (+31 / -14) | 0-100                        |


### 2.2 Complete Data Fields Available

Beyond the 5 displayed metrics, we collect and store these additional fields that could inform flagging rules:

#### Sleep Breakdown


| Field                    | Description                    | Unit                           |
| ------------------------ | ------------------------------ | ------------------------------ |
| `sleep_duration_seconds` | Total sleep duration           | seconds                        |
| `sleep_score`            | Overall sleep quality score    | 0-100                          |
| `sleep_score_qualifier`  | Quality label                  | EXCELLENT / GOOD / FAIR / POOR |
| `deep_sleep_seconds`     | Time in deep sleep             | seconds                        |
| `light_sleep_seconds`    | Time in light sleep            | seconds                        |
| `rem_sleep_seconds`      | Time in REM sleep              | seconds                        |
| `awake_seconds`          | Time awake during sleep period | seconds                        |


**Sleep Score Thresholds (Garmin):**

- Excellent: 90-100
- Good: 80-89
- Fair: 60-79
- Poor: Below 60

#### Stress Detail


| Field                            | Description                       | Unit                    |
| -------------------------------- | --------------------------------- | ----------------------- |
| `average_stress_level`           | Average stress throughout the day | 0-100                   |
| `max_stress_level`               | Peak stress level                 | 0-100                   |
| `stress_qualifier`               | Day classification                | e.g., "stressful_awake" |
| `rest_stress_duration_seconds`   | Time in rest state                | seconds                 |
| `low_stress_duration_seconds`    | Time in low stress                | seconds                 |
| `medium_stress_duration_seconds` | Time in medium stress             | seconds                 |
| `high_stress_duration_seconds`   | Time in high stress               | seconds                 |


**Garmin Stress Level Scale:**

- Rest: 1-25
- Low: 26-50
- Medium: 51-75
- High: 76-100

#### Heart Rate Variability (HRV)


| Field                       | Description                           | Unit         |
| --------------------------- | ------------------------------------- | ------------ |
| `hrv_last_night_average`    | Average HRV during sleep              | milliseconds |
| `hrv_last_night_5_min_high` | Best 5-minute HRV window during sleep | milliseconds |


**HRV Context:** Higher HRV generally indicates better recovery and resilience. A declining trend over days/weeks may signal accumulated stress or insufficient recovery.

#### Body Battery


| Field                      | Description                               | Unit  |
| -------------------------- | ----------------------------------------- | ----- |
| `body_battery_most_recent` | Current energy level                      | 0-100 |
| `body_battery_highest`     | Peak energy during the day                | 0-100 |
| `body_battery_lowest`      | Lowest energy during the day              | 0-100 |
| `body_battery_charged`     | Total energy gained (from rest/sleep)     | units |
| `body_battery_drained`     | Total energy spent (from activity/stress) | units |


#### Activity (supplementary)


| Field                 | Description                         | Unit    |
| --------------------- | ----------------------------------- | ------- |
| `steps`               | Daily step count                    | count   |
| `active_time_seconds` | Total active time                   | seconds |
| `resting_heart_rate`  | Resting HR (measured overnight)     | bpm     |
| `max_heart_rate`      | Peak heart rate                     | bpm     |
| `average_heart_rate`  | Average heart rate                  | bpm     |
| `active_calories`     | Calories from activity              | kcal    |
| `total_calories`      | Total daily calories (active + BMR) | kcal    |


---

## 3. How Data Is Collected

### 3.1 Data Flow Overview

```
Participant syncs Garmin device
        ↓
Garmin Connect processes data
        ↓
Garmin Health API pushes to our webhooks (4 endpoints)
        ↓
Each webhook:
  1. Verifies authenticity
  2. Resolves participant → pseudonym_id
  3. Stores raw payload (append-only)
  4. Extracts fields → upserts into garmin_metrics
  5. Logs result to ingestion_logs
        ↓
Admin dashboard displays merged daily view
```

### 3.2 Four Webhook Endpoints


| Garmin Endpoint      | Our URL                        | Data Delivered                                              |
| -------------------- | ------------------------------ | ----------------------------------------------------------- |
| HEALTH - Dailies     | `/api/garmin/webhooks/dailies` | Steps, HR, stress, body battery (charged/drained), calories |
| HEALTH - Sleeps      | `/api/garmin/webhooks/sleeps`  | Sleep duration, score, deep/light/REM breakdown             |
| HEALTH - HRV Summary | `/api/garmin/webhooks/hrv`     | Last night HRV average + 5-min peak                         |
| HEALTH - Stress      | `/api/garmin/webhooks/stress`  | Body battery score (0-100), highest, lowest                 |


### 3.3 Data Merge Strategy

All four endpoints merge into a **single row per participant per day** in `garmin_metrics`. Each endpoint only writes its own columns, so data never overwrites across sources. When a participant syncs their device multiple times in a day, the latest values replace the earlier ones (last-write-wins for cumulative daily totals).

### 3.4 Data Freshness

- Data arrives within **seconds** of a participant syncing their Garmin device with Garmin Connect
- Most participants sync 1-2 times per day (morning after sleep + evening)
- If a participant doesn't sync, no data is received — the system detects this as a "no data" gap

---

## 4. Privacy & Data Protection (PIPEDA)

### 4.1 Pseudonymization

Health data is **never stored alongside personally identifiable information (PII)**. A pseudonym mapping layer decouples the two:

```
PII Zone (participants table)          Health Zone (garmin_metrics, etc.)
┌──────────────────────┐               ┌──────────────────────┐
│ name: "John Smith"   │               │ pseudonym_id: abc123 │
│ email: john@...      │               │ resting_hr: 54       │
│ phone: +1-xxx        │               │ sleep_score: 82      │
└──────────┬───────────┘               │ stress_avg: 43       │
           │                           └──────────────────────┘
           ▼                                      ▲
┌──────────────────────┐                          │
│ participant_pseudonyms│──────────────────────────┘
│ hash: e076a4d7...    │  (encrypted mapping)
│ encrypted: base64... │
│ pseudonym_id: abc123 │
└──────────────────────┘
```

- The mapping table stores participant IDs as **encrypted blobs** (AES-256-GCM)
- Lookups use **HMAC-SHA256 hashes** (irreversible without the key)
- The encryption key lives **exclusively in Vercel environment variables** — never in the database
- A database dump reveals only opaque hashes and encrypted data

### 4.2 Raw Data Preservation

Every webhook payload is stored in append-only raw tables (`garmin_raw_dailies`, `garmin_raw_sleeps`, `garmin_raw_hrv`) with:

- Sensitive tokens (OAuth `userAccessToken`) **stripped before storage**
- Data linked only via `pseudonym_id` (not participant_id)
- Full payload preserved for audit, debugging, and potential reprocessing

### 4.3 Access Control (Row-Level Security)


| Table                              | Service Role | Admin         | Regular User |
| ---------------------------------- | ------------ | ------------- | ------------ |
| `participants` (PII)               | Full access  | Read-only     | No access    |
| `participant_pseudonyms` (mapping) | Full access  | **No access** | No access    |
| `garmin_metrics` (health data)     | Full access  | Read-only     | No access    |
| `garmin_tokens` (OAuth)            | Full access  | No access     | No access    |


---

## 5. Current Flagging Rules

Three rules are currently implemented as a starting point:


| Flag            | Condition                                  | Severity | Description                                            |
| --------------- | ------------------------------------------ | -------- | ------------------------------------------------------ |
| **NO_DATA**     | No metrics in last 3 days                  | Warning  | Participant may have stopped wearing device or syncing |
| **LOW_SLEEP**   | Sleep < 5 hours for 3 consecutive days     | Alert    | Persistent sleep deficit                               |
| **HIGH_STRESS** | Average stress > 80 for 3 consecutive days | Alert    | Sustained high stress                                  |


### How flags appear in the admin UI:

- Shown as colored badges next to the participant's name
- Warning (amber) for NO_DATA
- Alert (red) for LOW_SLEEP and HIGH_STRESS

---

## 6. Potential Flagging Rule Ideas

Based on the data we collect, here are possible rules the team could consider. These are **suggestions only** — the clinical/operational team should define the actual thresholds.

### Single-Day Thresholds


| Metric         | Possible Rule                      | Rationale                     |
| -------------- | ---------------------------------- | ----------------------------- |
| Sleep score    | Score < 40 (POOR)                  | Very poor sleep quality       |
| Sleep duration | < 4 hours                          | Critically insufficient sleep |
| REM sleep      | < 30 minutes                       | Inadequate REM recovery       |
| Stress avg     | > 70 for a day                     | High stress day               |
| Body battery   | Ends day below 10                  | Severe energy depletion       |
| RHR            | Change > 10 bpm from 7-day average | Unusual cardiac response      |


### Multi-Day Trend Rules


| Pattern        | Possible Rule                                  | Rationale                         |
| -------------- | ---------------------------------------------- | --------------------------------- |
| Sleep trend    | Average < 6h over 7 days                       | Chronic sleep debt                |
| HRV trend      | Declining for 5+ consecutive days              | Accumulating stress/poor recovery |
| Body battery   | Morning peak < 50 for 3+ days                  | Not recovering overnight          |
| Stress + Sleep | High stress (>60) AND low sleep (<6h) same day | Compounding risk                  |
| RHR trend      | Rising trend over 7 days                       | Possible overtraining/illness     |
| Data gap       | No sync for 3+ days                            | Disengagement indicator           |


### Composite / Cross-Metric Rules


| Pattern        | Possible Rule                             | Rationale             |
| -------------- | ----------------------------------------- | --------------------- |
| Recovery score | Low HRV + Low sleep + High stress         | Multi-signal distress |
| Engagement     | No data + no SMS response for 5 days      | Disengagement alert   |
| Acute change   | Body battery drops > 40 points in one day | Unusual energy drain  |


---

## 7. Data Limitations


| Limitation                      | Detail                                                                                                                        |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **Device must be worn**         | No data on days the watch isn't worn. Gaps in data are common.                                                                |
| **Sync required**               | Data only arrives after the participant syncs with Garmin Connect (usually via phone Bluetooth).                              |
| **Stress requires HR sensor**   | If the watch is too loose, stress and body battery may show as "unmeasurable" for periods.                                    |
| **HRV requires overnight wear** | HRV is only measured during sleep. No HRV if the watch isn't worn to bed.                                                     |
| **Body battery score**          | Requires the stress endpoint; charged/drained values come from dailies but the 0-100 score comes from the stress time-series. |
| **Garmin processing delay**     | There can be a few minutes between device sync and data appearing in our system.                                              |
| **Backfill cooldown**           | Garmin limits historical data backfill requests (~24h+ cooldown per request).                                                 |


---

## 8. Questions for the Team

1. **What sleep threshold should trigger a flag?** We currently use < 5 hours for 3 days. Should this be adjusted? Should sleep score (0-100) be used instead of duration?
2. **What stress threshold matters most?** Average daily stress, or time spent in high stress (>75) zone? We have both.
3. **Should HRV declining trends trigger flags?** If so, over how many days, and what percentage decline?
4. **Is body battery useful for flagging?** E.g., "body battery below 20 at end of day for 3+ days" could indicate chronic depletion.
5. **How should data gaps be handled?** Is 3 days without data the right threshold for a warning? Should it escalate to an alert after 5+ days?
6. **Should we combine metrics?** E.g., flag when BOTH stress > 60 AND sleep < 6 hours on the same day, even if neither alone would trigger a flag.
7. **What time window should trend analysis cover?** 3 days? 7 days? 14 days?

