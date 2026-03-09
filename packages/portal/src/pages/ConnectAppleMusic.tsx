import { Link } from 'react-router-dom';
import { useAppleMusic } from '../hooks/useAppleMusic';

export default function ConnectAppleMusic() {
  const { isAuthorized, isLoading, error, authorize, unauthorize } = useAppleMusic();

  return (
    <div className="page">
      <header className="page-header">
        <Link to="/dashboard" className="back-link">&larr; Back to Dashboard</Link>
        <h2>Apple Music Connection</h2>
      </header>

      <main className="page-content">
        <div className="card card-wide">
          <h3>Connection Status</h3>

          {isLoading ? (
            <p className="text-muted">Loading...</p>
          ) : (
            <>
              <p>
                Status:{' '}
                {isAuthorized ? (
                  <span className="badge badge-success">Connected</span>
                ) : (
                  <span className="badge badge-warning">Not Connected</span>
                )}
              </p>

              {error && <p className="text-error">{error}</p>}

              <div className="button-group">
                {isAuthorized ? (
                  <button className="btn btn-danger" onClick={unauthorize}>
                    Disconnect
                  </button>
                ) : (
                  <button className="btn btn-primary" onClick={authorize}>
                    Connect Apple Music
                  </button>
                )}
              </div>

              {!isAuthorized && (
                <p className="text-muted help-text">
                  Clicking "Connect Apple Music" will open an Apple authorization popup.
                  Sign in with your Apple ID to link your Apple Music account.
                </p>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
