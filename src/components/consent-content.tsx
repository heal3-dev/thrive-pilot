export default function ConsentContent() {
  return (
    <div className="space-y-6">
      <section>
        <h2 className="font-semibold text-slate-900 mb-2">Welcome to the Thrive Pilot</h2>
        <p className="text-sm text-slate-600">
          Thrive is a non-clinical support platform designed to help identify sustained physiological strain
          patterns over time and provide access to voluntary peer support before burnout, mental health leave,
          or psychological injury occurs.
        </p>
        <p className="text-sm text-slate-600 mt-3">
          Participation in the Thrive Pilot includes the use of a wearable device and access to a trained peer
          mentor who may conduct supportive check-ins if the system identifies sustained changes in
          physiological patterns.
        </p>
        <p className="text-sm text-slate-600 mt-3">
          Participation in the pilot is voluntary. Participants may withdraw at any time without penalty.
        </p>
      </section>

      <section>
        <h2 className="font-semibold text-slate-900 mb-2">Participant responsibilities</h2>
        <p className="text-sm text-slate-600 mb-2">
          By participating in the Thrive Pilot, participants agree to the following:
        </p>
        <ul className="text-sm text-slate-600 space-y-1.5 list-disc list-inside ml-2">
          <li>Wear the provided watch continuously for the first 14 days to establish an initial baseline.</li>
          <li>
            After the baseline period, wear the watch as often as possible so the system can detect sustained
            changes over time.
          </li>
          <li>
            The pilot is designed to run for a minimum of three months, as detecting meaningful physiological
            changes requires observation over time.
          </li>
          <li>The watch is provided by Thrive for the duration of the pilot.</li>
          <li>
            You will have access to a peer mentor who may reach out for voluntary check-ins if the system
            identifies sustained physiological changes.
          </li>
          <li>If the watch is not being used or participation stops, Thrive may request that the watch be returned.</li>
        </ul>
        <p className="text-sm text-slate-600 mt-3">
          These expectations help ensure the pilot can accurately evaluate whether physiological monitoring can
          support early wellbeing interventions.
        </p>
      </section>

      <section>
        <h2 className="font-semibold text-slate-900 mb-2">What the Thrive Pilot is (and is not)</h2>
        <p className="text-sm text-slate-600 mb-2">Thrive Pilot is designed as a wellbeing support tool.</p>
        <p className="text-sm font-medium text-slate-800 mt-3 mb-1">Thrive Pilot is:</p>
        <ul className="text-sm text-slate-600 space-y-1.5 list-disc list-inside ml-2">
          <li>A voluntary support pilot.</li>
          <li>Designed to help identify sustained physiological strain patterns over time.</li>
          <li>
            Intended to support early human check-ins before burnout, mental health leave, or psychological injury occurs.
          </li>
        </ul>
        <p className="text-sm font-medium text-slate-800 mt-4 mb-1">Thrive Pilot is not intended to be:</p>
        <ul className="text-sm text-slate-600 space-y-1.5 list-disc list-inside ml-2">
          <li>A diagnostic tool</li>
          <li>Medical care</li>
          <li>Mental health treatment</li>
          <li>An emergency medical response</li>
          <li>A performance management tool</li>
          <li>A system used to evaluate job performance or fitness for duty</li>
        </ul>
        <p className="text-sm text-slate-600 mt-3">
          Thrive does not replace professional medical care or emergency services. If you are in immediate danger
          or require urgent support, contact emergency services.
        </p>
      </section>

      <section>
        <h2 className="font-semibold text-slate-900 mb-2">What data Thrive uses (with your consent)</h2>
        <p className="text-sm text-slate-600">
          Participants are required to review and consent to the Thrive by Heal-3 Inc. (Pilot Version) Privacy Policy
          (the “Privacy Policy”). The Privacy Policy provides details about Thrive’s collection, use and disclosure of
          your personal information.
        </p>
        <p className="text-sm text-slate-600 mt-3 mb-2">
          Thrive uses a limited set of wearable-derived indicators to detect patterns over time. Data is used at a trend
          level, not to analyze individual events.
        </p>
        <p className="text-sm text-slate-600 mb-2">Examples of indicators that may be used include:</p>
        <ul className="text-sm text-slate-600 space-y-1.5 list-disc list-inside ml-2">
          <li>Sleep duration and disruption patterns over time.</li>
          <li>Recovery indicators such as heart rate variability (“HRV”) trends and resting heart rate trends.</li>
          <li>Stress or strain summaries provided by the wearable platform.</li>
          <li>System-generated flags indicating sustained deviation from your personal baseline.</li>
        </ul>
        <p className="text-sm text-slate-600 mt-3 mb-2">Thrive does not collect:</p>
        <ul className="text-sm text-slate-600 space-y-1.5 list-disc list-inside ml-2">
          <li>GPS or location data.</li>
          <li>Medical records or diagnoses.</li>
          <li>Clinical assessments or symptom screening.</li>
          <li>Employment, performance, or other data used for human resource purposes.</li>
        </ul>
      </section>

      <section>
        <h2 className="font-semibold text-slate-900 mb-2">How Thrive analyzes data</h2>
        <p className="text-sm text-slate-600 mb-2">
          Thrive does not rely on people reviewing or interpreting physiological data. Instead, the platform:
        </p>
        <ul className="text-sm text-slate-600 space-y-1.5 list-disc list-inside ml-2">
          <li>Establishes an individualized baseline based on patterns over time.</li>
          <li>Detects sustained deviations from that baseline.</li>
          <li>Generates a system flag when predefined thresholds are met.</li>
        </ul>
      </section>

      <section>
        <h2 className="font-semibold text-slate-900 mb-2">What a system flag means</h2>
        <p className="text-sm text-slate-600 mb-2">
          A flag means the system has detected a sustained change from your personal baseline. Flags may trigger an
          invitation for a supportive check-in from a peer mentor. A flag does not mean:
        </p>
        <ul className="text-sm text-slate-600 space-y-1.5 list-disc list-inside ml-2">
          <li>You are experiencing illness or injury.</li>
          <li>A medical condition has been identified.</li>
          <li>A diagnosis has been made.</li>
          <li>Any specific outcome is predicted.</li>
        </ul>
        <p className="text-sm text-slate-600 mt-3">
          You are not required to respond to outreach and may decline any check-in.
        </p>
      </section>

      <section>
        <h2 className="font-semibold text-slate-900 mb-2">Who can access your data</h2>
        <p className="text-sm text-slate-600">
          Thrive uses a role-based access model designed to protect participant privacy. No single role has unrestricted
          access to all information.
        </p>
      </section>

      <section>
        <h2 className="font-semibold text-slate-900 mb-2">Participant rights</h2>
        <p className="text-sm text-slate-600 mb-2">As a participant in the Thrive pilot, you have the right to:</p>
        <ul className="text-sm text-slate-600 space-y-1.5 list-disc list-inside ml-2">
          <li>Be treated with respect and dignity.</li>
          <li>Ask questions about how the pilot operates.</li>
          <li>Understand how your personal information is used and protected.</li>
          <li>Decline outreach or participation in any peer check-in.</li>
          <li>Withdraw from the pilot at any time without penalty.</li>
        </ul>
      </section>

      <section>
        <h2 className="font-semibold text-slate-900 mb-2">Technology limitations</h2>
        <p className="text-sm text-slate-600 mb-2">
          The Thrive pilot relies on consumer wearable devices and mobile connectivity. Participants should be aware that:
        </p>
        <ul className="text-sm text-slate-600 space-y-1.5 list-disc list-inside ml-2">
          <li>Wearable devices may occasionally record incomplete or inaccurate data.</li>
          <li>Data collection may be interrupted if the watch is not worn, removed, or disconnected.</li>
          <li>Connectivity or software interruptions may occur.</li>
        </ul>
        <p className="text-sm text-slate-600 mt-3">
          Because of these factors, the system may occasionally miss changes or generate flags based on incomplete data.
          Thrive should not be relied upon as a real-time monitoring or safety system.
        </p>
      </section>

      <section>
        <h2 className="font-semibold text-slate-900 mb-2">Limitations of physiological indicators</h2>
        <p className="text-sm text-slate-600 mb-2">
          The physiological indicators used by Thrive are not diagnostic medical measurements. Indicators such as sleep
          patterns, HRV trends, resting heart rate, and stress summaries are used only to identify general patterns over time.
        </p>
        <p className="text-sm text-slate-600 mb-2">These indicators:</p>
        <ul className="text-sm text-slate-600 space-y-1.5 list-disc list-inside ml-2">
          <li>Do not diagnose medical or mental health conditions.</li>
          <li>Do not predict illness or psychological injury.</li>
          <li>May be influenced by many factors such as illness, exercise, hydration, shift work, or stress.</li>
        </ul>
        <p className="text-sm text-slate-600 mt-3">
          System-generated flags are intended only to prompt supportive check-ins. Participants should consult qualified
          healthcare professionals for medical concerns.
        </p>
      </section>

      <section>
        <h2 className="font-semibold text-slate-900 mb-2">
          Not used for operational or fitness-for-duty decisions
        </h2>
        <p className="text-sm text-slate-600">
          Data collected through the Thrive pilot will not be used to determine operational readiness, job performance, or
          fitness for duty. Thrive is designed solely as a voluntary wellbeing initiative and is not intended to influence
          employment or operational decisions.
        </p>
      </section>

      <section>
        <h2 className="font-semibold text-slate-900 mb-2">Access to support and emergency situations</h2>
        <p className="text-sm text-slate-600 mb-2">
          Thrive provides voluntary peer support check-ins but does not operate as an emergency service. Peer mentors
          participating in the pilot may not always be immediately available.
        </p>
        <p className="text-sm text-slate-600">
          If you require immediate assistance or are experiencing a crisis, do not rely on the Thrive platform as Thrive does
          not provide any medical services, whether urgent, emergency or otherwise.
        </p>
        <p className="text-sm text-slate-600 mt-3 mb-2">
          In the case of an emergency or if you are needing immediate support, please call 911, go to your nearest hospital
          emergency centre, or call one of the emergency community support services listed below:
        </p>
        <ul className="text-sm text-slate-600 space-y-1.5 list-disc list-inside ml-2">
          <li>988 Suicide Crisis Helpline (Canada/US): call or text 988</li>
          <li>Distress Line in Edmonton – 780-482-4357 (HELP)</li>
          <li>Distress Line in Calgary – 403-266-1605</li>
          <li>Adult Crisis Response Team (24/7) – 780-424-2424</li>
        </ul>
        <p className="text-sm text-slate-600 mt-3">
          Contact information for these services may change from time to time. Participants are encouraged to review resources
          online for the most up to date contact information.
        </p>
      </section>

      <section className="bg-teal-50 border border-teal-100 rounded-xl p-4">
        <h2 className="font-semibold text-slate-900 mb-2">Statement of informed consent</h2>
        <p className="text-sm text-slate-700 mb-2">By selecting “I Agree &amp; Continue,” you confirm that:</p>
        <ul className="text-sm text-slate-700 list-disc list-inside ml-2 space-y-1">
          <li>You have read, understood and agree to the terms of this document and the Privacy Policy.</li>
          <li>You agree to participate in the Thrive Pilot.</li>
          <li>You understand the purpose and limitations of the Thrive pilot.</li>
          <li>You understand that Thrive is not medical care and does not provide diagnosis or treatment.</li>
          <li>You understand that participation is voluntary.</li>
          <li>You understand that you may withdraw from the Thrive Pilot at any time without penalty.</li>
          <li>
            You consent to receiving outreach communications (including SMS) from assigned peer mentors as part of the Thrive Pilot.
          </li>
        </ul>
      </section>
    </div>
  );
}

