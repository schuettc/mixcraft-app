import { useUser, useClerk } from '@clerk/clerk-react';
import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useApi } from '../hooks/useApi';

export default function Dashboard() {
  const { user } = useUser();
  const { signOut } = useClerk();
  const { apiFetch } = useApi();
  const [appleMusicConnected, setAppleMusicConnected] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch('/api/apple-music/status')
      .then((data) => {
        if (!cancelled) setAppleMusicConnected(data.connected);
      })
      .catch(() => {
        if (!cancelled) setAppleMusicConnected(false);
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <h1>Music MCP</h1>
        <div className="header-right">
          <span className="user-email">{user?.primaryEmailAddress?.emailAddress}</span>
          <button className="btn btn-secondary" onClick={() => signOut()}>
            Sign Out
          </button>
        </div>
      </header>

      <main className="dashboard-content">
        <h2>Dashboard</h2>

        <div className="card-grid">
          <div className="card">
            <h3>Apple Music</h3>
            {appleMusicConnected === null ? (
              <p className="text-muted">Checking status...</p>
            ) : appleMusicConnected ? (
              <>
                <span className="badge badge-success">Connected</span>
                <p className="card-text">Your Apple Music account is linked.</p>
                <Link to="/connect" className="btn btn-secondary">
                  Manage Connection
                </Link>
              </>
            ) : (
              <>
                <span className="badge badge-warning">Not Connected</span>
                <p className="card-text">Connect your Apple Music account to get started.</p>
                <Link to="/connect" className="btn btn-primary">
                  Connect Apple Music
                </Link>
              </>
            )}
          </div>

          <div className="card">
            <h3>API Keys</h3>
            <p className="card-text">
              Manage API keys for Claude Code MCP integration.
            </p>
            <Link to="/api-keys" className="btn btn-primary">
              Manage API Keys
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
