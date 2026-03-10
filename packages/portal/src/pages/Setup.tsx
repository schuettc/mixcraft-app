import { useState } from 'react';
import Header from '../components/Header';
import { useAppleMusic } from '../hooks/useAppleMusic';
import { useApiKeys, type CreateKeyResult } from '../hooks/useApiKeys';

export default function Setup() {
  const { isAuthorized, isLoading: appleMusicLoading, error: appleMusicError, authorize, unauthorize } = useAppleMusic();
  const { keys, isLoading: keysLoading, error: keysError, createKey, deleteKey } = useApiKeys();

  const [createdKey, setCreatedKey] = useState<CreateKeyResult | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ keyHash: string; prefix: string } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [disconnectConfirm, setDisconnectConfirm] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedConfig, setCopiedConfig] = useState(false);

  async function handleCreate() {
    setCreating(true);
    try {
      const result = await createKey('Default');
      setCreatedKey(result);
    } catch {
      // Error surfaced via hook
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(deleteTarget.keyHash);
    try {
      await deleteKey(deleteTarget.keyHash);
    } finally {
      setDeleting(null);
      setDeleteTarget(null);
    }
  }

  async function handleDisconnect() {
    setDisconnectConfirm(false);
    await unauthorize();
  }

  function handleCopy(text: string) {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const hasKeys = keys && keys.length > 0;

  const configJson = JSON.stringify({
    mcpServers: {
      mixcraft: {
        command: 'npx',
        args: ['-y', 'mixcraft-app@latest'],
        env: {
          MIXCRAFT_API_KEY: createdKey ? createdKey.rawKey : 'your-api-key-here',
        },
      },
    },
  }, null, 2);

  return (
    <div className="setup-page">
      <Header />

      <main className="setup-content">
        <div className="setup-intro">
          <p>
            Mixcraft gives Claude Code access to your music library.
            Connect a service, grab an API key, and paste the config into Claude Code.
          </p>
        </div>

        {/* Step 1: Connect a Music Service */}
        <section className="step-section">
          <div className="step-header">
            <div className="step-title-row">
              {isAuthorized ? (
                <span className="step-complete" aria-label="Complete">&#10003;</span>
              ) : (
                <span className="step-number">1</span>
              )}
              <h2>Connect a Music Service</h2>
            </div>
          </div>

          <div className="card card-wide">
            <div className="card-header-row">
              <h3>Apple Music</h3>
              {appleMusicLoading ? (
                <span className="badge badge-muted">Checking...</span>
              ) : isAuthorized ? (
                <span className="badge badge-success">Connected</span>
              ) : (
                <span className="badge badge-warning">Not Connected</span>
              )}
            </div>

            {appleMusicError && <p className="text-error">{appleMusicError}</p>}

            {!appleMusicLoading && (
              <div className="button-group">
                {isAuthorized ? (
                  <button className="btn btn-danger" onClick={() => setDisconnectConfirm(true)}>
                    Disconnect
                  </button>
                ) : (
                  <button className="btn btn-primary" onClick={authorize}>
                    Connect Apple Music
                  </button>
                )}
              </div>
            )}

            {!isAuthorized && !appleMusicLoading && (
              <p className="text-muted help-text">
                Clicking "Connect Apple Music" will open an Apple authorization popup.
                Sign in with your Apple ID to link your Apple Music account.
              </p>
            )}
          </div>
        </section>

        {/* Step 2: Create an API Key */}
        <section className="step-section">
          <div className="step-header">
            <div className="step-title-row">
              {hasKeys ? (
                <span className="step-complete" aria-label="Complete">&#10003;</span>
              ) : (
                <span className="step-number">2</span>
              )}
              <h2>Create an API Key</h2>
            </div>
          </div>

          {createdKey && (
            <div className="card card-wide card-highlight">
              <h3>New API Key Created</h3>
              <p className="text-error">
                <strong>Warning:</strong> This key will not be shown again. Copy it now and store it securely.
              </p>
              <div className="key-display">
                <code className="key-value">{createdKey.rawKey}</code>
                <button className="btn btn-secondary btn-sm" onClick={() => handleCopy(createdKey.rawKey)}>
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
              <button className="btn btn-secondary" onClick={() => setCreatedKey(null)}>
                Dismiss
              </button>
            </div>
          )}

          <div className="card card-wide">
            <div className="card-header-row">
              <h3>Your API Keys</h3>
              <button className="btn btn-primary" onClick={handleCreate} disabled={creating}>
                {creating ? 'Creating...' : 'Create New Key'}
              </button>
            </div>

            {keysError && <p className="text-error">{keysError}</p>}

            {keysLoading ? (
              <p className="text-muted">Loading keys...</p>
            ) : !hasKeys ? (
              <p className="text-muted">No API keys yet. Create one to continue.</p>
            ) : (
              <div className="table-wrapper">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Prefix</th>
                      <th>Created</th>
                      <th>Last Used</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {keys.map((key) => (
                      <tr key={key.keyHash}>
                        <td><code>{key.keyPrefix}...</code></td>
                        <td>{new Date(key.createdAt).toLocaleDateString()}</td>
                        <td>{key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleDateString() : 'Never'}</td>
                        <td>
                          <button
                            className="btn btn-danger btn-sm"
                            onClick={() => setDeleteTarget({ keyHash: key.keyHash, prefix: key.keyPrefix })}
                            disabled={deleting === key.keyHash}
                          >
                            {deleting === key.keyHash ? 'Deleting...' : 'Delete'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>

        {/* Step 3: Add to Claude Code */}
        <section className="step-section">
          <div className="step-header">
            <div className="step-title-row">
              <span className="step-number">3</span>
              <h2>Add to Claude Code</h2>
            </div>
          </div>

          <div className="card card-wide">
            <div className="card-header-row">
              <h3>MCP Configuration</h3>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  navigator.clipboard.writeText(configJson);
                  setCopiedConfig(true);
                  setTimeout(() => setCopiedConfig(false), 2000);
                }}
              >
                {copiedConfig ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <p className="card-text">
              Add the following to your <code>.mcp.json</code> file:
            </p>
            <pre className="code-block">{configJson}</pre>
          </div>
        </section>
      </main>

      {/* Delete key confirmation modal */}
      {deleteTarget && (
        <div className="modal-overlay" onClick={() => setDeleteTarget(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Delete API Key</h3>
            <p>Are you sure you want to delete the key starting with <strong>{deleteTarget.prefix}...</strong>? This cannot be undone.</p>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setDeleteTarget(null)}>
                Cancel
              </button>
              <button
                className="btn btn-danger"
                onClick={handleDelete}
                disabled={deleting === deleteTarget.keyHash}
              >
                {deleting === deleteTarget.keyHash ? 'Deleting...' : 'Delete Key'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Disconnect Apple Music confirmation modal */}
      {disconnectConfirm && (
        <div className="modal-overlay" onClick={() => setDisconnectConfirm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Disconnect Apple Music</h3>
            <p>Are you sure you want to disconnect your Apple Music account? You can reconnect at any time.</p>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setDisconnectConfirm(false)}>
                Cancel
              </button>
              <button className="btn btn-danger" onClick={handleDisconnect}>
                Disconnect
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
