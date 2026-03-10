import { ClerkProvider, SignedIn, SignedOut, RedirectToSignIn } from '@clerk/clerk-react';
import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { loadConfig, type AppConfig } from './config';
import { Login, Register } from './pages/Login';
import Setup from './pages/Setup';

export default function App() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadConfig().then(setConfig).catch((e) => setError(e.message));
  }, []);

  if (error) return <div>Failed to load configuration: {error}</div>;
  if (!config) return null;

  return (
    <ClerkProvider publishableKey={config.clerkPublishableKey}>
      <BrowserRouter>
        <Routes>
          <Route
            path="/"
            element={
              <>
                <SignedIn>
                  <Navigate to="/setup" replace />
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
                  <Navigate to="/setup" replace />
                </SignedIn>
                <SignedOut>
                  <Register />
                </SignedOut>
              </>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </ClerkProvider>
  );
}
