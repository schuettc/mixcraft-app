import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import Header from '../components/Header';
import { useAppleMusic } from '../hooks/useAppleMusic';
import { useServices } from '../hooks/useServices';
import { useServiceSync } from '../hooks/useServiceSync';
import { useSpotifyConnect } from '../hooks/useSpotifyConnect';
import { useApiKeys, type CreateKeyResult } from '../hooks/useApiKeys';
import { useSharedPlaylists } from '../hooks/useSharedPlaylists';

type ConfigTab = 'claude-ai' | 'claude-code-cli' | 'claude-desktop';

export default function Dashboard() {
  const { isAuthorized, isLoading: appleMusicLoading, error: appleMusicError, authorize, unauthorize } = useAppleMusic();
  const [connectingApple, setConnectingApple] = useState(false);
  const { services, isLoading: servicesLoading, refresh: refreshServices, disconnect } = useServices();
  const { connect: connectSpotify, isConnecting: connectingSpotify, error: spotifyError } = useSpotifyConnect(refreshServices);
  const { keys, isLoading: keysLoading, error: keysError, createKey, deleteKey } = useApiKeys();
  const { shares, isLoading: sharesLoading, error: sharesError, deleteShare } = useSharedPlaylists();

  // Auto-sync OAuth tokens from social login
  const { syncFailures, dismissFailure } = useServiceSync(refreshServices);

  const [createdKey, setCreatedKey] = useState<CreateKeyResult | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ keyHash: string; prefix: string } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [disconnectConfirm, setDisconnectConfirm] = useState(false);
  const [deleteShareTarget, setDeleteShareTarget] = useState<{ shareId: string; title: string } | null>(null);
  const [deletingShare, setDeletingShare] = useState<string | null>(null);
  const [copiedShareUrl, setCopiedShareUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copiedConfig, setCopiedConfig] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [configTab, setConfigTab] = useState<ConfigTab>('claude-ai');

  const hasKeys = keys && keys.length > 0;
  const hasAnyConnection = isAuthorized || services.spotify.connected;
  const isSetupComplete = hasAnyConnection && hasKeys;
  const isLoading = appleMusicLoading || keysLoading || servicesLoading || sharesLoading;

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

  async function handleDeleteShare() {
    if (!deleteShareTarget) return;
    setDeletingShare(deleteShareTarget.shareId);
    try {
      await deleteShare(deleteShareTarget.shareId);
    } finally {
      setDeletingShare(null);
      setDeleteShareTarget(null);
    }
  }

  function handleCopyShareUrl(url: string) {
    navigator.clipboard.writeText(url);
    setCopiedShareUrl(url);
    setTimeout(() => setCopiedShareUrl(null), 2000);
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

  function handleCopyField(field: string, text: string) {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  }

  function handleCopyConfig() {
    navigator.clipboard.writeText(activeConfig);
    setCopiedConfig(true);
    setTimeout(() => setCopiedConfig(false), 2000);
  }

  const mcpConfig = JSON.stringify({
    mcpServers: {
      mixcraft: {
        command: 'npx',
        args: ['-y', 'mixcraft-app@latest'],
        env: {
          MIXCRAFT_API_KEY: 'mx_your_key_here',
        },
      },
    },
  }, null, 2);

  const activeConfig = configTab === 'claude-ai' ? '' : mcpConfig;

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
            <p>Your music {isAuthorized && services.spotify.connected ? 'services are' : 'service is'} connected. Add MixCraft to Claude to start managing your music.</p>
          </div>
        </div>

        {syncFailures.map((failure) => (
          <div key={failure.provider} className="card card-wide" style={{ borderLeft: '3px solid var(--color-error)' }}>
            <div className="card-header-row">
              <div>
                <h3 style={{ color: 'var(--color-error)' }}>{failure.provider} sync failed</h3>
                <p className="text-muted" style={{ marginTop: '0.25rem' }}>
                  We couldn't automatically connect your {failure.provider} account. Use the Connect button below to try again.
                </p>
              </div>
              <button className="btn btn-secondary btn-sm" onClick={() => dismissFailure(failure.provider)}>
                Dismiss
              </button>
            </div>
          </div>
        ))}

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
                className={`config-tab ${configTab === 'claude-ai' ? 'config-tab-active' : ''}`}
                onClick={() => setConfigTab('claude-ai')}
              >
                claude.ai / Desktop
              </button>
              <button
                className={`config-tab ${configTab === 'claude-code-cli' ? 'config-tab-active' : ''}`}
                onClick={() => setConfigTab('claude-code-cli')}
              >
                Claude Code CLI
              </button>
              <button
                className={`config-tab ${configTab === 'claude-desktop' ? 'config-tab-active' : ''}`}
                onClick={() => setConfigTab('claude-desktop')}
              >
                Claude Desktop
              </button>
            </div>

            {configTab === 'claude-ai' && (
              <div className="config-instructions">
                <h4 className="config-section-title">Connector (recommended) — no API key needed</h4>
                <p className="card-text" style={{ fontWeight: 500, color: 'var(--color-text)' }}>
                  1. Go to <strong>Customize &gt; Connectors &gt; + &gt; Add custom connector</strong>
                </p>
                <p className="card-text" style={{ fontWeight: 500, color: 'var(--color-text)' }}>
                  2. Fill in the details:
                </p>
                <div className="copyable-fields">
                  <div className="copyable-field">
                    <span className="copyable-field-label">Name</span>
                    <code className="copyable-field-value">Mixcraft</code>
                    <button className="btn btn-secondary btn-sm" onClick={() => handleCopyField('name', 'Mixcraft')}>
                      {copiedField === 'name' ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                  <div className="copyable-field">
                    <span className="copyable-field-label">Remote MCP server URL</span>
                    <code className="copyable-field-value">https://mcp.mixcraft.app/mcp</code>
                    <button className="btn btn-secondary btn-sm" onClick={() => handleCopyField('url', 'https://mcp.mixcraft.app/mcp')}>
                      {copiedField === 'url' ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                </div>
                <p className="card-text" style={{ fontWeight: 500, color: 'var(--color-text)', marginTop: '1.25rem' }}>
                  3. Expand <strong>Advanced settings</strong> and add the OAuth Client ID:
                </p>
                <div className="copyable-fields">
                  <div className="copyable-field">
                    <span className="copyable-field-label">OAuth Client ID</span>
                    <code className="copyable-field-value">FLECRN3FqkNiXtGI</code>
                    <button className="btn btn-secondary btn-sm" onClick={() => handleCopyField('clientId', 'FLECRN3FqkNiXtGI')}>
                      {copiedField === 'clientId' ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                </div>
                <p className="card-text" style={{ fontWeight: 500, color: 'var(--color-text)', marginTop: '1.25rem' }}>
                  4. Click <strong>Add</strong>, then sign in with your MixCraft account to authorize
                </p>

                <hr className="config-divider" />

                <h4 className="config-section-title">Plugin — includes the playlist assistant skill</h4>
                <p className="card-text">
                  The plugin adds a playlist assistant skill that curates playlists with intentional energy arcs and learns your taste over time.
                </p>
                <p className="card-text" style={{ fontWeight: 500, color: 'var(--color-text)' }}>
                  1. Click the <strong>+</strong> button next to the prompt box and select <strong>Plugins</strong>
                </p>
                <p className="card-text" style={{ fontWeight: 500, color: 'var(--color-text)' }}>
                  2. Select <strong>Add plugin</strong> to open the plugin browser
                </p>
                <p className="card-text" style={{ fontWeight: 500, color: 'var(--color-text)' }}>
                  3. Find <strong>MixCraft</strong> and install it (choose User, Project, or Local scope)
                </p>
                <p className="card-text" style={{ marginTop: '0.75rem' }}>
                  If the marketplace isn't listed, add it first: run <code>/plugin</code>, go to the <strong>Marketplaces</strong> tab, and add <code>schuettc/mixcraft-app</code>.
                </p>
                <p className="card-text" style={{ fontWeight: 500, color: 'var(--color-text)', marginTop: '1.25rem' }}>
                  Set your API key:
                </p>
                <div className="code-block-wrapper">
                  <button
                    className="btn btn-secondary btn-sm code-copy-btn"
                    onClick={() => handleCopyField('export', 'export MIXCRAFT_API_KEY="mx_your_key_here"')}
                  >
                    {copiedField === 'export' ? 'Copied!' : 'Copy'}
                  </button>
                  <pre className="code-block">{'export MIXCRAFT_API_KEY="mx_your_key_here"'}</pre>
                </div>
                <p className="card-text" style={{ marginTop: '0.75rem' }}>
                  Add this to your shell profile (<code>.zshrc</code>, <code>.bashrc</code>, etc.) so it persists across sessions.
                </p>
              </div>
            )}

            {configTab === 'claude-code-cli' && (
              <div className="config-instructions">
                <h4 className="config-section-title">Plugin (recommended) — includes the playlist assistant skill</h4>
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
                  2. Reload plugins:
                </p>
                <div className="code-block-wrapper">
                  <button
                    className="btn btn-secondary btn-sm code-copy-btn"
                    onClick={() => handleCopyField('reload', '/reload-plugins')}
                  >
                    {copiedField === 'reload' ? 'Copied!' : 'Copy'}
                  </button>
                  <pre className="code-block">{'/reload-plugins'}</pre>
                </div>
                <p className="card-text" style={{ fontWeight: 500, color: 'var(--color-text)', marginTop: '1.25rem' }}>
                  3. Set your API key:
                </p>
                <div className="code-block-wrapper">
                  <button
                    className="btn btn-secondary btn-sm code-copy-btn"
                    onClick={() => handleCopyField('export', 'export MIXCRAFT_API_KEY="mx_your_key_here"')}
                  >
                    {copiedField === 'export' ? 'Copied!' : 'Copy'}
                  </button>
                  <pre className="code-block">{'export MIXCRAFT_API_KEY="mx_your_key_here"'}</pre>
                </div>
                <p className="card-text" style={{ marginTop: '0.75rem' }}>
                  Add this to your shell profile (<code>.zshrc</code>, <code>.bashrc</code>, etc.) so it persists across sessions.
                </p>

                <hr className="config-divider" />

                <h4 className="config-section-title">MCP only — tools without the playlist assistant skill</h4>
                <p className="card-text">
                  Add the following to your project's <code>.mcp.json</code> file:
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
                  Add the following to your Claude Desktop config file. Replace <code>mx_your_key_here</code> with your API key.
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
                  After saving, restart Claude Desktop. MixCraft will appear under Settings &gt; Connectors.
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

        {/* Shared Playlists */}
        {shares.length > 0 && (
          <section className="step-section">
            <div className="step-header">
              <div className="step-title-row">
                <h2>Shared Playlists</h2>
              </div>
            </div>

            <div className="card card-wide">
              {sharesError && <p className="text-error">{sharesError}</p>}

              <div className="table-wrapper">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Playlist</th>
                      <th>Service</th>
                      <th>Tracks</th>
                      <th>Shared</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shares.map((share) => (
                      <tr key={share.shareId}>
                        <td>{share.title}</td>
                        <td>{share.service === 'apple_music' ? 'Apple Music' : 'Spotify'}</td>
                        <td>{share.trackCount}</td>
                        <td>{new Date(share.createdAt).toLocaleDateString()}</td>
                        <td>
                          <div style={{ display: 'flex', gap: '0.5rem' }}>
                            <button
                              className="btn btn-secondary btn-sm"
                              onClick={() => handleCopyShareUrl(share.shareUrl)}
                            >
                              {copiedShareUrl === share.shareUrl ? 'Copied!' : 'Copy Link'}
                            </button>
                            <button
                              className="btn btn-danger btn-sm"
                              onClick={() => setDeleteShareTarget({ shareId: share.shareId, title: share.title })}
                              disabled={deletingShare === share.shareId}
                            >
                              {deletingShare === share.shareId ? 'Deleting...' : 'Delete'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}

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
              {isAuthorized ? (
                <span className="badge badge-success">Connected</span>
              ) : (
                <span className="badge badge-muted">Not Connected</span>
              )}
            </div>
            {appleMusicError && <p className="text-error">{appleMusicError}</p>}
            {isAuthorized ? (
              <button className="btn btn-danger btn-sm" onClick={() => setDisconnectConfirm(true)}>
                Disconnect
              </button>
            ) : (
              <button className="btn btn-primary btn-sm" onClick={async () => {
                setConnectingApple(true);
                try { await authorize(); } finally { setConnectingApple(false); }
              }} disabled={connectingApple}>
                {connectingApple ? 'Connecting...' : 'Connect Apple Music'}
              </button>
            )}
          </div>

          <div className="card card-wide">
            <div className="card-header-row">
              <h3>Spotify</h3>
              {services.spotify.connected ? (
                <span className="badge badge-success">Connected</span>
              ) : (
                <span className="badge badge-muted">Not Connected</span>
              )}
            </div>
            {spotifyError && <p className="text-error">{spotifyError}</p>}
            {services.spotify.connected ? (
              <button className="btn btn-danger btn-sm" onClick={() => disconnect('spotify')}>
                Disconnect
              </button>
            ) : (
              <button className="btn btn-primary btn-sm" onClick={connectSpotify} disabled={connectingSpotify}>
                {connectingSpotify ? 'Connecting...' : 'Connect Spotify'}
              </button>
            )}
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

      {/* Delete shared playlist confirmation modal */}
      {deleteShareTarget && (
        <div className="modal-overlay" onClick={() => setDeleteShareTarget(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Delete Shared Playlist</h3>
            <p>Are you sure you want to delete the shared link for <strong>{deleteShareTarget.title}</strong>? Anyone with the link will no longer be able to view it.</p>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setDeleteShareTarget(null)}>
                Cancel
              </button>
              <button
                className="btn btn-danger"
                onClick={handleDeleteShare}
                disabled={deletingShare === deleteShareTarget.shareId}
              >
                {deletingShare === deleteShareTarget.shareId ? 'Deleting...' : 'Delete Share'}
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
