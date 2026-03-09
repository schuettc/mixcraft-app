import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApiKeys, type CreateKeyResult } from '../hooks/useApiKeys';

export default function ApiKeys() {
  const { keys, isLoading, error, createKey, deleteKey } = useApiKeys();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [createdKey, setCreatedKey] = useState<CreateKeyResult | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copiedConfig, setCopiedConfig] = useState(false);

  async function handleCreate() {
    if (!newKeyName.trim()) return;
    setCreating(true);
    try {
      const result = await createKey(newKeyName.trim());
      setCreatedKey(result);
      setNewKeyName('');
      setShowCreateModal(false);
    } catch {
      // Error is surfaced via the hook
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(keyHash: string) {
    if (!confirm('Are you sure you want to delete this API key? This cannot be undone.')) return;
    setDeleting(keyHash);
    try {
      await deleteKey(keyHash);
    } finally {
      setDeleting(null);
    }
  }

  function handleCopy(text: string) {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="page">
      <header className="page-header">
        <Link to="/dashboard" className="back-link">&larr; Back to Dashboard</Link>
        <h2>API Keys</h2>
      </header>

      <main className="page-content">
        {/* Created key display */}
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

        {/* Key list */}
        <div className="card card-wide">
          <div className="card-header-row">
            <h3>Your API Keys</h3>
            <button className="btn btn-primary" onClick={() => setShowCreateModal(true)}>
              Create New Key
            </button>
          </div>

          {error && <p className="text-error">{error}</p>}

          {isLoading ? (
            <p className="text-muted">Loading keys...</p>
          ) : !keys || keys.length === 0 ? (
            <p className="text-muted">No API keys yet. Create one to get started.</p>
          ) : (
            <div className="table-wrapper">
              <table className="table">
                <thead>
                  <tr>
                    <th>Prefix</th>
                    <th>Name</th>
                    <th>Created</th>
                    <th>Last Used</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {keys.map((key) => (
                    <tr key={key.keyHash}>
                      <td><code>{key.keyPrefix}...</code></td>
                      <td>{key.name}</td>
                      <td>{new Date(key.createdAt).toLocaleDateString()}</td>
                      <td>{key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleDateString() : 'Never'}</td>
                      <td>
                        <button
                          className="btn btn-danger btn-sm"
                          onClick={() => handleDelete(key.keyHash)}
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

        {/* Instructions */}
        <div className="card card-wide">
          <div className="card-header-row">
            <h3>Claude Code MCP Configuration</h3>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => {
                const config = JSON.stringify({
                  mcpServers: {
                    music: {
                      command: "npx",
                      args: ["-y", "mixcraft-app"],
                      env: {
                        MIXCRAFT_API_KEY: createdKey ? createdKey.rawKey : "your-api-key-here",
                      },
                    },
                  },
                }, null, 2);
                navigator.clipboard.writeText(config);
                setCopiedConfig(true);
                setTimeout(() => setCopiedConfig(false), 2000);
              }}
            >
              {copiedConfig ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <p className="card-text">
            Add the following to your Claude Code MCP config to use your API key:
          </p>
          <pre className="code-block">{`{
  "mcpServers": {
    "music": {
      "command": "npx",
      "args": ["-y", "mixcraft-app"],
      "env": {
        "MIXCRAFT_API_KEY": "${createdKey ? createdKey.rawKey : 'your-api-key-here'}"
      }
    }
  }
}`}</pre>
        </div>

        {/* Create modal */}
        {showCreateModal && (
          <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <h3>Create New API Key</h3>
              <label className="form-label">
                Key Name
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g., My MacBook"
                  value={newKeyName}
                  onChange={(e) => setNewKeyName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                  autoFocus
                />
              </label>
              <div className="modal-actions">
                <button className="btn btn-secondary" onClick={() => setShowCreateModal(false)}>
                  Cancel
                </button>
                <button
                  className="btn btn-primary"
                  onClick={handleCreate}
                  disabled={!newKeyName.trim() || creating}
                >
                  {creating ? 'Creating...' : 'Create Key'}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
