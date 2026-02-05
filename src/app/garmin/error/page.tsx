import { redirect } from 'next/navigation';

interface ErrorPageProps {
  searchParams: Promise<{ reason?: string }>;
}

export default async function GarminErrorPage({ searchParams }: ErrorPageProps) {
  const params = await searchParams;
  const reason = params.reason || 'unknown';
  
  const errorMessages: Record<string, { title: string; message: string; action: string }> = {
    invalid_link: {
      title: 'Invalid or Expired Link',
      message: 'This magic link is no longer valid. Magic links expire after 24 hours for security.',
      action: 'Please request a new invite from your program administrator.',
    },
    missing_context: {
      title: 'Missing Information',
      message: 'We couldn\'t find the necessary information to connect your Garmin device.',
      action: 'Please use the magic link sent to your email to connect your device.',
    },
    already_connected: {
      title: 'Already Connected',
      message: 'Your Garmin device is already connected to Thrive Pilot.',
      action: 'No further action needed. Your wellness data is being synced.',
    },
    garmin_unavailable: {
      title: 'Garmin Service Unavailable',
      message: 'We\'re having trouble connecting to Garmin right now. This might be temporary.',
      action: 'Please try again in a few minutes. If the problem persists, contact support.',
    },
    unknown: {
      title: 'Something Went Wrong',
      message: 'An unexpected error occurred while connecting your Garmin device.',
      action: 'Please try again or contact support if the problem continues.',
    },
  };
  
  const error = errorMessages[reason] || errorMessages.unknown;
  
  return (
    <div className="flex items-center justify-center min-h-screen bg-slate-50">
      <div className="text-center max-w-md px-6">
        <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-red-100 flex items-center justify-center">
          <svg 
            className="w-8 h-8 text-red-600" 
            fill="none" 
            viewBox="0 0 24 24" 
            stroke="currentColor" 
            strokeWidth={2}
          >
            <path 
              strokeLinecap="round" 
              strokeLinejoin="round" 
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" 
            />
          </svg>
        </div>
        
        <h1 className="text-2xl font-bold text-slate-900 mb-3">
          {error.title}
        </h1>
        
        <p className="text-slate-600 mb-4">
          {error.message}
        </p>
        
        <p className="text-sm text-slate-500 mb-8">
          {error.action}
        </p>
        
        {reason === 'already_connected' && (
          <button
            onClick={() => redirect('/dashboard')}
            className="inline-flex items-center justify-center px-6 py-3 bg-teal-600 text-white font-medium rounded-lg hover:bg-teal-700 transition-colors"
          >
            Go to Dashboard
          </button>
        )}
      </div>
    </div>
  );
}
