import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import Header from '../components/Header';
import { useAppleMusic } from '../hooks/useAppleMusic';
import { useApiKeys, type CreateKeyResult } from '../hooks/useApiKeys';

type ConfigTab = 'claude-code' | 'claude-desktop' | 'plugin';

export default function Dashboard() {
  const { isAuthorized, isLoading: appleMusicLoading, error: appleMusicError, unauthorize } = useAppleMusic();
  const { keys, isLoading: keysLoading, error: keysError, createKey, deleteKey } = useApiKeys();

  const [createdKey, setCreatedKey] = useState<CreateKeyResult | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ keyHash: string; prefix: string } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [disconnectConfirm, setDisconnectConfirm] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedConfig, setCopiedConfig] = useState(false);
  const [configTab, setConfigTab] = useState<ConfigTab>('plugin');

  const hasKeys = keys && keys.length > 0;
  const isSetupComplete = isAuthorized && hasKeys;
  const isLoading = appleMusicLoading || keysLoading;

  // Redirect to /setup if not fully set up
  if (!isLoading && !isSetupComplete) {
    return <Navigate to="/setup" replace />;
  }

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

  function handleCopyConfig() {
    navigator.clipboard.writeText(activeConfig);
    setCopiedConfig(true);
    setTimeout(() => setCopiedConfig(false), 2000);
  }

  const keyForConfig = createdKey ? createdKey.rawKey : 'mx_your_key_here';

  const mcpConfig = JSON.stringify({
    mcpServers: {
      mixcraft: {
        command: 'npx',
        args: ['-y', 'mixcraft-app@latest'],
        env: {
          MIXCRAFT_API_KEY: keyForConfig,
        },
      },
    },
  }, null, 2);

  const activeConfig = configTab === 'plugin' ? '' : mcpConfig;

  if (isLoading) {
    return (
      <div className="setup-page">
        <Header />
        <main className="setup-content">
          <p className="text-muted">Loading...</p>
        </main>
      </div>
    );
  }

  return (
    <div className="setup-page">
      <Header />
      <main className="setup-content">
        <div className="success-banner">
          <span className="success-icon">&#10003;</span>
          <div>
            <h2>You're all set</h2>
            <p>Apple Music is connected and your API key is ready. Add Mixcraft to Claude to start managing your music.</p>
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

        {/* Getting started with tabs */}
        <section className="step-section">
          <div className="step-header">
            <div className="step-title-row">
              <h2>Add to Claude</h2>
            </div>
          </div>

          <div className="card card-wide">
            <div className="config-tabs">
              <button
                className={`config-tab ${configTab === 'plugin' ? 'config-tab-active' : ''}`}
                onClick={() => setConfigTab('plugin')}
              >
                Plugin (Recommended)
              </button>
              <button
                className={`config-tab ${configTab === 'claude-code' ? 'config-tab-active' : ''}`}
                onClick={() => setConfigTab('claude-code')}
              >
                Claude Code
              </button>
              <button
                className={`config-tab ${configTab === 'claude-desktop' ? 'config-tab-active' : ''}`}
                onClick={() => setConfigTab('claude-desktop')}
              >
                Claude Desktop
              </button>
            </div>

            {configTab === 'plugin' && (
              <div className="config-instructions">
                <p className="card-text">
                  The Mixcraft plugin gives Claude Code the MCP tools plus a playlist assistant skill
                  that curates playlists with intentional energy arcs and learns your taste over time.
                </p>
                <p className="card-text" style={{ fontWeight: 500, color: 'var(--color-text)' }}>
                  1. Add the marketplace and install:
                </p>
                <div className="code-block-wrapper">
                  <button
                    className="btn btn-secondary btn-sm code-copy-btn"
                    onClick={() => {
                      navigator.clipboard.writeText('/plugin marketplace add schuettc/mixcraft-app\n/plugin install mixcraft@mixcraft-app');
                      setCopiedConfig(true);
                      setTimeout(() => setCopiedConfig(false), 2000);
                    }}
                  >
                    {copiedConfig ? 'Copied!' : 'Copy'}
                  </button>
                  <pre className="code-block">{'/plugin marketplace add schuettc/mixcraft-app\n/plugin install mixcraft@mixcraft-app'}</pre>
                </div>
                <p className="card-text" style={{ fontWeight: 500, color: 'var(--color-text)', marginTop: '1.25rem' }}>
                  2. Set your API key:
                </p>
                <div className="code-block-wrapper">
                  <pre className="code-block">{`export MIXCRAFT_API_KEY="${keyForConfig}"`}</pre>
                </div>
                <p className="card-text" style={{ marginTop: '0.75rem' }}>
                  Add this to your shell profile (<code>.zshrc</code>, <code>.bashrc</code>, etc.) so it persists across sessions.
                </p>
              </div>
            )}

            {configTab === 'claude-code' && (
              <div className="config-instructions">
                <p className="card-text">
                  Add the following to your project's <code>.mcp.json</code> file for MCP-only access (no playlist skill):
                </p>
                <div className="code-block-wrapper">
                  <button className="btn btn-secondary btn-sm code-copy-btn" onClick={handleCopyConfig}>
                    {copiedConfig ? 'Copied!' : 'Copy'}
                  </button>
                  <pre className="code-block">{activeConfig}</pre>
                </div>
              </div>
            )}

            {configTab === 'claude-desktop' && (
              <div className="config-instructions">
                <p className="card-text">
                  Add the following to your Claude Desktop config file:
                </p>
                <p className="card-text config-path">
                  <strong>macOS:</strong> <code>~/Library/Application Support/Claude/claude_desktop_config.json</code>
                </p>
                <p className="card-text config-path">
                  <strong>Windows:</strong> <code>%APPDATA%\Claude\claude_desktop_config.json</code>
                </p>
                <div className="code-block-wrapper">
                  <button className="btn btn-secondary btn-sm code-copy-btn" onClick={handleCopyConfig}>
                    {copiedConfig ? 'Copied!' : 'Copy'}
                  </button>
                  <pre className="code-block">{activeConfig}</pre>
                </div>
                <p className="card-text" style={{ marginTop: '1rem' }}>
                  After saving, restart Claude Desktop. Mixcraft will appear under Settings &gt; Connectors.
                </p>
              </div>
            )}
          </div>
        </section>

        {/* Usage examples */}
        <section className="step-section">
          <div className="step-header">
            <div className="step-title-row">
              <h2>What you can do</h2>
            </div>
          </div>

          <div className="card card-wide">
            <p className="card-text">Once connected, just ask Claude about music naturally:</p>
            <div className="usage-examples">
              <div className="usage-example">"Make me a playlist for a long drive"</div>
              <div className="usage-example">"What have I been listening to lately?"</div>
              <div className="usage-example">"Add some new songs to my workout playlist"</div>
              <div className="usage-example">"I need focus music for coding"</div>
              <div className="usage-example">"Find me something like Radiohead but more electronic"</div>
            </div>
            <p className="card-text" style={{ marginTop: '1rem' }}>
              Claude will check your listening history and preferences before making recommendations,
              and always confirm before creating playlists or adding tracks.
            </p>
          </div>
        </section>

        {/* Compact management section */}
        <section className="step-section">
          <div className="step-header">
            <div className="step-title-row">
              <h2>Manage</h2>
            </div>
          </div>

          <div className="card card-wide">
            <div className="card-header-row">
              <h3>Apple Music</h3>
              <span className="badge badge-success">Connected</span>
            </div>
            {appleMusicError && <p className="text-error">{appleMusicError}</p>}
            <button className="btn btn-danger btn-sm" onClick={() => setDisconnectConfirm(true)}>
              Disconnect
            </button>
          </div>

          <div className="card card-wide">
            <div className="card-header-row">
              <h3>API Keys</h3>
              <button className="btn btn-primary btn-sm" onClick={handleCreate} disabled={creating}>
                {creating ? 'Creating...' : 'Create New Key'}
              </button>
            </div>

            {keysError && <p className="text-error">{keysError}</p>}

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
                  {keys!.map((key) => (
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
