'use client';

import { useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

function GarminConnectContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  
  useEffect(() => {
    const participantId = searchParams.get('participant_id');
    const action = searchParams.get('action');
    
    // Validate that this came from a Garmin OAuth invite
    if (!participantId || action !== 'garmin_connect') {
      console.error('[GARMIN_CONNECT] Invalid parameters');
      router.push('/dashboard');
      return;
    }
    
    // TODO: Redirect to Garmin OAuth flow
    // For now, just show message
    console.log('[GARMIN_CONNECT] Ready to initiate OAuth for participant:', participantId);
    
    // const garminAuthUrl = new URL('https://connect.garmin.com/oauthConfirm');
    // garminAuthUrl.searchParams.set('oauth_token', 'REQUEST_TOKEN');
    // window.location.href = garminAuthUrl.toString();
  }, [router, searchParams]);
  
  return (
    <div className="flex items-center justify-center min-h-screen bg-slate-50">
      <div className="text-center max-w-md px-6">
        <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-teal-100 flex items-center justify-center">
          <svg 
            className="w-8 h-8 text-teal-600" 
            fill="none" 
            viewBox="0 0 24 24" 
            stroke="currentColor" 
            strokeWidth={2}
          >
            <path 
              strokeLinecap="round" 
              strokeLinejoin="round" 
              d="M13 10V3L4 14h7v7l9-11h-7z" 
            />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-slate-900 mb-3">
          Connecting to Garmin
        </h1>
        <p className="text-slate-600 mb-6">
          Preparing to redirect you to Garmin Connect...
        </p>
        <div className="flex items-center justify-center gap-2 text-sm text-slate-400">
          <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path 
              className="opacity-75" 
              fill="currentColor" 
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" 
            />
          </svg>
          <span>Please wait...</span>
        </div>
      </div>
    </div>
  );
}

export default function GarminConnectPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <GarminConnectContent />
    </Suspense>
  );
}
