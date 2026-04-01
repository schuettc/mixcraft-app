import { ClerkProvider, SignedIn, SignedOut, RedirectToSignIn, AuthenticateWithRedirectCallback, useAuth } from '@clerk/clerk-react';
import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
// Routes/Route also used at top-level App for public share page
import { loadConfig, type AppConfig } from './config';
import { Login, Register } from './pages/Login';
import Setup from './pages/Setup';
import Dashboard from './pages/Dashboard';
import SharePage from './pages/SharePage';

function OAuthRedirectHandler() {
  const { isSignedIn } = useAuth();
  const [searchParams] = useSearchParams();
  const redirectUrl = searchParams.get('redirect_url');

  useEffect(() => {
    if (isSignedIn && redirectUrl) {
      try {
        const url = new URL(redirectUrl);
        if (url.hostname.endsWith('.mixcraft.app') || url.hostname.endsWith('.clerk.accounts.dev')) {
          window.location.href = redirectUrl;
        }
      } catch {
        // Invalid URL, ignore
      }
    }
  }, [isSignedIn, redirectUrl]);

  if (redirectUrl) return null;
  return <Dashboard />;
}

function ClerkProviderWithRoutes({ publishableKey }: { publishableKey: string }) {
  const navigate = useNavigate();

  return (
    <ClerkProvider
      publishableKey={publishableKey}
      routerPush={(to) => navigate(to)}
      routerReplace={(to) => navigate(to, { replace: true })}
      signInUrl="/"
      signUpUrl="/sign-up"
      afterSignOutUrl="/"
    >
      <Routes>
        <Route
          path="/"
          element={
            <>
              <SignedIn>
                <OAuthRedirectHandler />
              </SignedIn>
              <SignedOut>
                <Login />
              </SignedOut>
            </>
          }
        />
        <Route
          path="/setup"
          element={
            <>
              <SignedIn>
                <Setup />
              </SignedIn>
              <SignedOut>
                <RedirectToSignIn />
              </SignedOut>
            </>
          }
        />
        <Route
          path="/sign-up"
          element={
            <>
              <SignedIn>
                <Navigate to="/" replace />
              </SignedIn>
              <SignedOut>
                <Register />
              </SignedOut>
            </>
          }
        />
        <Route
          path="/sso-callback"
          element={<AuthenticateWithRedirectCallback />}
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ClerkProvider>
  );
}

export default function App() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadConfig().then(setConfig).catch((e) => setError(e.message));
  }, []);

  if (error) return <div>Failed to load configuration: {error}</div>;
  if (!config) return null;

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/share/:id" element={<SharePage />} />
        <Route path="*" element={<ClerkProviderWithRoutes publishableKey={config.clerkPublishableKey} />} />
      </Routes>
    </BrowserRouter>
  );
}
