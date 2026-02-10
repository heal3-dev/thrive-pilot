export default function PrivacyContent() {
  return (
    <div className="space-y-6">
      {/* What Thrive is (and is not) */}
      <section>
        <h2 className="font-semibold text-slate-900 mb-3">What Thrive is (and is not)</h2>
        <ul className="text-sm text-slate-600 space-y-1.5 list-disc list-inside ml-2">
          <li>Thrive is a <strong>voluntary, preventive support pilot</strong></li>
          <li>Thrive <strong>does not diagnose</strong> medical or mental health conditions</li>
          <li>Thrive <strong>does not provide clinical or medical advice</strong></li>
          <li>Thrive is <strong>not medical care</strong></li>
          <li>Thrive is <strong>not emergency response</strong></li>
          <li>Thrive is <strong>not used to evaluate performance or fitness for duty</strong></li>
        </ul>
        <p className="text-sm text-slate-600 mt-3">
          The goal is to support early, human check-ins before burnout, mental health leave, or psychological injury.
        </p>
      </section>

      {/* What data Thrive uses */}
      <section>
        <h2 className="font-semibold text-slate-900 mb-3">What data Thrive uses (with your consent)</h2>
        <ul className="text-sm text-slate-600 list-disc list-inside ml-2 space-y-1">
          <li>Limited, <strong>trend-level indicators</strong> from your wearable device</li>
          <li>This may include:
            <ul className="list-[circle] list-inside ml-4 mt-1 space-y-1">
              <li>Sleep duration and disruption (over time)</li>
              <li>Recovery indicators (e.g., HRV trends, resting heart rate trends)</li>
              <li>Stress or strain summaries</li>
              <li>System-generated flags when patterns change from your personal baseline</li>
            </ul>
          </li>
        </ul>
        <p className="text-sm text-slate-600 mt-3 mb-2">Thrive does <strong>not</strong> collect:</p>
        <ul className="text-sm text-slate-600 list-disc list-inside ml-2 space-y-1">
          <li>GPS or location data</li>
          <li>Medical records or diagnoses</li>
          <li>Clinical assessments or symptom screening</li>
          <li>Employment, performance, or HR data</li>
        </ul>
      </section>

      {/* How your data is used */}
      <section>
        <h2 className="font-semibold text-slate-900 mb-3">How your data is used</h2>
        <ul className="text-sm text-slate-600 list-disc list-inside ml-2 space-y-1">
          <li>To establish your personal baseline</li>
          <li>To detect sustained physiological changes over time</li>
          <li>To prompt a supportive, non-clinical check-in when appropriate</li>
        </ul>
      </section>

      {/* What a system flag means */}
      <section>
        <h2 className="font-semibold text-slate-900 mb-3">What a system flag means</h2>
        <ul className="text-sm text-slate-600 list-disc list-inside ml-2 space-y-1">
          <li>A flag means the system has identified a sustained change from your personal baseline</li>
          <li>Flags are sent to peer mentors to prompt a check-in</li>
          <li>A flag simply indicates that a supportive check-in may be helpful</li>
        </ul>
        <h2 className="font-semibold text-slate-900 mt-4 mb-3">What a flag does <em>not</em> mean</h2>
        <ul className="text-sm text-slate-600 list-disc list-inside ml-2 space-y-1">
          <li>It is not a diagnosis</li>
          <li>It does not mean illness or injury</li>
          <li>It does not predict risk or outcomes</li>
          <li>It does not require any action from you</li>
        </ul>
      </section>

      {/* Who can access your data */}
      <section>
        <h2 className="font-semibold text-slate-900 mb-3">Who can access your data</h2>
        
        <h3 className="text-sm font-medium text-slate-800 mt-3 mb-1">You</h3>
        <ul className="text-sm text-slate-600 list-disc list-inside ml-2 space-y-1">
          <li>Control your participation</li>
          <li>Choose what you share during any check-in conversation</li>
          <li>May withdraw from the pilot at any time</li>
        </ul>

        <h3 className="text-sm font-medium text-slate-800 mt-3 mb-1">Peer mentors</h3>
        <ul className="text-sm text-slate-600 list-disc list-inside ml-2 space-y-1">
          <li>Can see high-level trends and system flags</li>
          <li>Do not have access to raw wearable data</li>
          <li>Cannot see sleep charts, HRV values, stress metrics, or detailed physiological data</li>
          <li>Do not interpret biometric data</li>
          <li>Do not provide clinical advice</li>
          <li>Rely only on what you voluntarily share</li>
        </ul>

        <h3 className="text-sm font-medium text-slate-800 mt-3 mb-1">Platform administrator (pilot only)</h3>
        <ul className="text-sm text-slate-600 list-disc list-inside ml-2 space-y-1">
          <li>Oversees system operations and outreach coordination</li>
          <li>Does not routinely review raw biometric data</li>
          <li>Any deeper access is:
            <ul className="list-[circle] list-inside ml-4 mt-1 space-y-1">
              <li>Rare</li>
              <li>Logged</li>
              <li>Time-limited</li>
              <li>Restricted to technical troubleshooting or participant-requested support</li>
            </ul>
          </li>
        </ul>
      </section>

      {/* Data storage and protection */}
      <section>
        <h2 className="font-semibold text-slate-900 mb-3">Data storage and protection</h2>
        <ul className="text-sm text-slate-600 list-disc list-inside ml-2 space-y-1">
          <li>Data is stored securely <strong>in Canada</strong></li>
          <li>Encrypted in transit and at rest</li>
          <li>Role-based access controls are used</li>
          <li>Access is logged and monitored</li>
          <li>Data is retained only for the duration of the pilot</li>
          <li>Data is deleted or anonymized if you withdraw</li>
        </ul>
      </section>

      {/* Your choice */}
      <section>
        <h2 className="font-semibold text-slate-900 mb-3">Your choice</h2>
        <ul className="text-sm text-slate-600 list-disc list-inside ml-2 space-y-1">
          <li>Participation is <strong>voluntary</strong></li>
          <li>You may opt out at any time without penalty</li>
        </ul>
      </section>
    </div>
  );
}
