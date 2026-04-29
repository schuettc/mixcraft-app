import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import Header from '../components/Header';
import { useAppleMusic } from '../hooks/useAppleMusic';
import { useAppConfig } from '../hooks/useAppConfig';
import { useServices } from '../hooks/useServices';
import { useServiceSync } from '../hooks/useServiceSync';
import { useSpotifyConnect } from '../hooks/useSpotifyConnect';
import { useApiKeys, type CreateKeyResult } from '../hooks/useApiKeys';

type ConfigTab = 'claude-ai' | 'claude-code-cli' | 'claude-desktop';

export default function Setup() {
  const config = useAppConfig();
  const enableSpotify = config?.enableSpotify ?? false;
  const { isAuthorized, isLoading: appleMusicLoading, error: appleMusicError, authorize, unauthorize } = useAppleMusic();
  const { services, isLoading: servicesLoading, error: servicesError, refresh: refreshServices, disconnect } = useServices();
  const { connect: connectSpotify, isConnecting: connectingSpotify, error: spotifyError } = useSpotifyConnect(refreshServices);
  const { keys, isLoading: keysLoading, error: keysError, createKey, deleteKey } = useApiKeys();

  const [createdKey, setCreatedKey] = useState<CreateKeyResult | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ keyHash: string; prefix: string } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [disconnectConfirm, setDisconnectConfirm] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copiedConfig, setCopiedConfig] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [configTab, setConfigTab] = useState<ConfigTab>('claude-ai');

  // Auto-sync OAuth tokens from social login
  const { syncFailures, dismissFailure } = useServiceSync(refreshServices);

  const hasKeys = keys && keys.length > 0;
  // Stale Spotify token records may exist for users connected before a
  // flag flip — only count Spotify as a satisfying connection when the
  // current deployment actually exposes Spotify support.
  const hasAnyConnection = isAuthorized || (enableSpotify && services.spotify.connected);
  const isSetupComplete = hasAnyConnection && hasKeys && !appleMusicLoading && !keysLoading && !servicesLoading;

  // Redirect to dashboard when setup is complete (but not while showing a new key)
  if (isSetupComplete && !createdKey) {
    return <Navigate to="/" replace />;
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
    const provider = disconnectConfirm;
    setDisconnectConfirm(null);
    if (provider === 'apple_music') {
      await unauthorize();
    } else if (provider) {
      await disconnect(provider);
    }
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

  const activeConfig = configTab === 'claude-ai' ? '' : mcpConfig;

  function handleCopyConfig() {
    navigator.clipboard.writeText(activeConfig);
    setCopiedConfig(true);
    setTimeout(() => setCopiedConfig(false), 2000);
  }

  return (
    <div className="setup-page">
      <Header />

      <main className="setup-content">
        <div className="setup-intro">
          <p>
            MixCraft gives Claude access to your music library.
            Connect a service, grab an API key, and paste the config into Claude.
          </p>
        </div>

        {/* Step 1: Connect a Music Service */}
        <section className="step-section">
          <div className="step-header">
            <div className="step-title-row">
              {hasAnyConnection ? (
                <span className="step-complete" aria-label="Complete">&#10003;</span>
              ) : (
                <span className="step-number">1</span>
              )}
              <h2>Connect a Music Service</h2>
            </div>
          </div>

          <p className="text-muted" style={{ marginBottom: '1rem' }}>
            {enableSpotify
              ? 'Connect at least one service. You can connect both to use them together.'
              : 'Connect Apple Music to get started.'}
          </p>

          {servicesError && <p className="text-error">{servicesError}</p>}

          {syncFailures.map((failure) => (
            <div key={failure.provider} className="card card-wide" style={{ borderLeft: '3px solid var(--color-error)' }}>
              <div className="card-header-row">
                <div>
                  <h3 style={{ color: 'var(--color-error)' }}>{failure.provider} auto-connect failed</h3>
                  <p className="text-muted" style={{ marginTop: '0.25rem' }}>
                    Use the Connect button below to link your {failure.provider} account.
                  </p>
                </div>
                <button className="btn btn-secondary btn-sm" onClick={() => dismissFailure(failure.provider)}>
                  Dismiss
                </button>
              </div>
            </div>
          ))}

          {/* Apple Music Card */}
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
                  <button className="btn btn-danger" onClick={() => setDisconnectConfirm('apple_music')}>
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
                Opens an Apple authorization popup. Sign in with your Apple ID to link your Apple Music account.
              </p>
            )}
          </div>

          {/* Spotify Card — hidden on deployments without enableSpotify */}
          {enableSpotify && (
            <div className="card card-wide" style={{ marginTop: '1rem' }}>
              <div className="card-header-row">
                <h3>Spotify</h3>
                {servicesLoading ? (
                  <span className="badge badge-muted">Checking...</span>
                ) : services.spotify.connected ? (
                  <span className="badge badge-success">Connected</span>
                ) : (
                  <span className="badge badge-warning">Not Connected</span>
                )}
              </div>

              {spotifyError && <p className="text-error">{spotifyError}</p>}

              {!servicesLoading && (
                <div className="button-group">
                  {services.spotify.connected ? (
                    <button className="btn btn-danger" onClick={() => setDisconnectConfirm('spotify')}>
                      Disconnect
                    </button>
                  ) : (
                    <button className="btn btn-primary" onClick={connectSpotify} disabled={connectingSpotify}>
                      {connectingSpotify ? 'Connecting...' : 'Connect Spotify'}
                    </button>
                  )}
                </div>
              )}

              {!services.spotify.connected && !servicesLoading && (
                <p className="text-muted help-text">
                  You'll be redirected to Spotify to authorize access to your music library.
                </p>
              )}
            </div>
          )}
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

        {/* Step 3: Add to Claude */}
        <section className="step-section">
          <div className="step-header">
            <div className="step-title-row">
              <span className="step-number">3</span>
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
                    onClick={() => handleCopyField('export', `export MIXCRAFT_API_KEY="${keyForConfig}"`)}
                  >
                    {copiedField === 'export' ? 'Copied!' : 'Copy'}
                  </button>
                  <pre className="code-block">{`export MIXCRAFT_API_KEY="${keyForConfig}"`}</pre>
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
                    onClick={() => handleCopyField('export', `export MIXCRAFT_API_KEY="${keyForConfig}"`)}
                  >
                    {copiedField === 'export' ? 'Copied!' : 'Copy'}
                  </button>
                  <pre className="code-block">{`export MIXCRAFT_API_KEY="${keyForConfig}"`}</pre>
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
                  After saving, restart Claude Desktop. MixCraft will appear under Settings &gt; Connectors.
                </p>
              </div>
            )}
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

      {/* Disconnect service confirmation modal */}
      {disconnectConfirm && (
        <div className="modal-overlay" onClick={() => setDisconnectConfirm(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Disconnect {disconnectConfirm === 'apple_music' ? 'Apple Music' : 'Spotify'}</h3>
            <p>Are you sure you want to disconnect your {disconnectConfirm === 'apple_music' ? 'Apple Music' : 'Spotify'} account? You can reconnect at any time.</p>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setDisconnectConfirm(null)}>
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
