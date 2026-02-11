export default function GarminSuccessPage() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-teal-50 to-slate-50 flex items-center justify-center p-4 sm:p-6">
      <article className="bg-white rounded-3xl shadow-xl border-2 border-slate-100 max-w-lg w-full p-6 sm:p-8 text-center">
        <div
          className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6"
          aria-hidden="true"
        >
          <svg className="w-10 h-10 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>

        <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-3">Garmin Connected</h1>

        <p className="text-base sm:text-lg text-slate-600 mb-6">
          Your Garmin account is now connected to Thrive Pilot.
        </p>

        <div className="bg-teal-50 rounded-xl p-5 sm:p-6 border border-teal-100">
          <p className="text-teal-800 text-sm">
            You can close this page now. We will begin syncing your wellness data shortly.
          </p>
        </div>

        <div className="mt-6 space-y-4 text-left">
          <h2 className="font-semibold text-slate-800">What happens next?</h2>
          <ul className="text-sm text-slate-600 space-y-2">
            <li>Your wellness data will sync automatically each day</li>
            <li>Your mentor will see trend-level indicators only</li>
            <li>No GPS, location, or medical data is collected</li>
          </ul>
        </div>

        <a
          href="/privacy"
          className="text-teal-600 hover:underline focus:underline focus:outline-none text-sm mt-6 inline-block"
        >
          View Privacy Policy
        </a>
      </article>
    </main>
  );
}
