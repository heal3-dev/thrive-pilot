"use client";

/**
 * MentorInbox - Displays participant conversations for mentors
 * Placeholder component for TICKET #13
 */
export function MentorInbox() {
  return (
    <div className="bg-white rounded-2xl border-2 border-slate-100 p-8 sm:p-12">
      <div className="text-center max-w-md mx-auto">
        {/* Icon */}
        <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-teal-50 flex items-center justify-center">
          <svg
            className="w-8 h-8 text-teal-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
            />
          </svg>
        </div>

        {/* Content */}
        <h2 className="text-xl font-bold text-slate-900 mb-3">
          Mentor Inbox Coming Soon
        </h2>
        <p className="text-base text-slate-500 leading-relaxed">
          This is where you&apos;ll see your assigned participants and manage SMS
          conversations. The full inbox implementation is in progress.
        </p>

        {/* Feature Preview */}
        <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-4 text-left">
          <div className="p-4 rounded-xl bg-slate-50">
            <div className="w-8 h-8 rounded-lg bg-white flex items-center justify-center mb-3 shadow-sm">
              <svg
                className="w-4 h-4 text-slate-600"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
                />
              </svg>
            </div>
            <h3 className="font-semibold text-slate-900 text-sm">Participants</h3>
            <p className="text-xs text-slate-500 mt-1">View assigned participants</p>
          </div>

          <div className="p-4 rounded-xl bg-slate-50">
            <div className="w-8 h-8 rounded-lg bg-white flex items-center justify-center mb-3 shadow-sm">
              <svg
                className="w-4 h-4 text-slate-600"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
                />
              </svg>
            </div>
            <h3 className="font-semibold text-slate-900 text-sm">Messages</h3>
            <p className="text-xs text-slate-500 mt-1">Read & send SMS</p>
          </div>

          <div className="p-4 rounded-xl bg-slate-50">
            <div className="w-8 h-8 rounded-lg bg-white flex items-center justify-center mb-3 shadow-sm">
              <svg
                className="w-4 h-4 text-slate-600"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
                />
              </svg>
            </div>
            <h3 className="font-semibold text-slate-900 text-sm">Notifications</h3>
            <p className="text-xs text-slate-500 mt-1">Real-time updates</p>
          </div>
        </div>
      </div>
    </div>
  );
}
