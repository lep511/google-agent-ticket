import { useState, useEffect } from 'react';

const COOKIE_CONSENT_KEY = 'tickr.cookieConsent';

export function CookieConsent() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const consent = localStorage.getItem(COOKIE_CONSENT_KEY);
    if (!consent) setVisible(true);
  }, []);

  const accept = () => {
    localStorage.setItem(COOKIE_CONSENT_KEY, 'accepted');
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-stone-800 border-t border-stone-700 px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-lg">
      <p className="text-sm text-stone-300 text-center sm:text-left">
        This site uses cookies and local storage to keep you signed in and save your session history.
        By continuing, you agree to our use of cookies.
      </p>
      <button
        onClick={accept}
        className="shrink-0 px-5 py-2 bg-white text-stone-900 font-medium text-sm rounded-lg hover:bg-stone-200 transition-colors"
      >
        Accept
      </button>
    </div>
  );
}
