import { useParams } from 'react-router-dom';
import { useShareData } from '../hooks/useShareData';
import type { TrackData } from '../hooks/useShareData';

function formatDuration(seconds?: number): string {
  if (!seconds) return '';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function totalDuration(tracks: TrackData[]): string {
  const total = tracks.reduce((sum, t) => sum + (t.duration ?? 0), 0);
  if (total === 0) return '';
  const mins = Math.round(total / 60);
  return `${mins} min`;
}

function serviceUrl(service: string, externalId: string | null): string | null {
  if (!externalId) return null;
  // Apple Music library playlists (p.xxx) aren't publicly accessible
  if (service === 'apple_music' && externalId.startsWith('p.')) return null;
  if (service === 'spotify') return `https://open.spotify.com/playlist/${externalId}`;
  if (service === 'apple_music') return `https://music.apple.com/playlist/${externalId}`;
  return null;
}

function serviceLabel(service: string): string {
  return service === 'apple_music' ? 'Apple Music' : 'Spotify';
}

interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
}

function buildConversationTurns(
  userMessages: string[],
  assistantMessages: string[],
  conversationSummary: string | null,
): ConversationTurn[] | null {
  // Prefer structured arrays if available
  if (userMessages.length > 0 || assistantMessages.length > 0) {
    const turns: ConversationTurn[] = [];
    const maxLen = Math.max(userMessages.length, assistantMessages.length);
    for (let i = 0; i < maxLen; i++) {
      if (i < userMessages.length && userMessages[i]) {
        turns.push({ role: 'user', content: userMessages[i] });
      }
      if (i < assistantMessages.length && assistantMessages[i]) {
        turns.push({ role: 'assistant', content: assistantMessages[i] });
      }
    }
    return turns.length >= 2 ? turns : null;
  }

  // Fallback: try to parse "User: ..." / "Assistant: ..." from conversationSummary
  if (!conversationSummary) return null;
  const lines = conversationSummary.split('\n');
  const turns: ConversationTurn[] = [];
  let currentRole: 'user' | 'assistant' | null = null;
  let currentContent: string[] = [];

  for (const line of lines) {
    const userMatch = line.match(/^User:\s*(.*)/i);
    const assistantMatch = line.match(/^Assistant:\s*(.*)/i);

    if (userMatch) {
      if (currentRole && currentContent.length > 0) {
        turns.push({ role: currentRole, content: currentContent.join('\n').trim() });
      }
      currentRole = 'user';
      currentContent = [userMatch[1]];
    } else if (assistantMatch) {
      if (currentRole && currentContent.length > 0) {
        turns.push({ role: currentRole, content: currentContent.join('\n').trim() });
      }
      currentRole = 'assistant';
      currentContent = [assistantMatch[1]];
    } else if (currentRole) {
      currentContent.push(line);
    }
  }

  if (currentRole && currentContent.length > 0) {
    turns.push({ role: currentRole, content: currentContent.join('\n').trim() });
  }

  return turns.length >= 2 ? turns : null;
}

export default function SharePage() {
  const { id } = useParams<{ id: string }>();
  const { data, status } = useShareData(id ?? '');

  if (status === 'loading') {
    return (
      <div className="share-page">
        <ShareHeader />
        <main className="share-container">
          <div className="share-skeleton">
            <div className="skeleton-block skeleton-hero" />
            <div className="skeleton-block skeleton-conversation" />
            <div className="skeleton-block skeleton-tracks" />
          </div>
        </main>
      </div>
    );
  }

  if (status === 'not_found' || status === 'error' || !data) {
    return (
      <div className="share-page">
        <ShareHeader />
        <main className="share-container">
          <div className="share-error">
            <h2>{status === 'not_found' ? 'Playlist not found' : 'Something went wrong'}</h2>
            <p className="text-muted">
              {status === 'not_found'
                ? 'This playlist may have been deleted or the link has expired.'
                : 'We couldn\'t load this playlist. Please try again.'}
            </p>
            <a href="https://mixcraft.app" className="btn btn-primary">Go to MixCraft</a>
          </div>
        </main>
      </div>
    );
  }

  const deepLink = serviceUrl(data.service, data.playlistExternalId);
  const duration = totalDuration(data.tracks);
  const conversationTurns = buildConversationTurns(
    data.userMessages ?? [],
    data.assistantMessages ?? [],
    data.conversationSummary,
  );

  return (
    <div className="share-page">
      <ShareHeader />
      <main className="share-container">
        <div className="playlist-hero">
          <span className={`service-badge service-badge-${data.service === 'apple_music' ? 'apple' : 'spotify'}`}>
            {serviceLabel(data.service)}
          </span>
          <h1 className="playlist-title">{data.title}</h1>
          <div className="playlist-meta">
            <span>{data.trackCount} tracks</span>
            {duration && (
              <>
                <span className="dot" />
                <span>{duration}</span>
              </>
            )}
          </div>
          {deepLink && (
            <a href={deepLink} target="_blank" rel="noopener noreferrer" className={`open-in-service open-in-service-${data.service === 'apple_music' ? 'apple' : 'spotify'}`}>
              Open in {serviceLabel(data.service)}
            </a>
          )}
        </div>

        {(conversationTurns || data.conversationSummary) && (
          <section className="share-section">
            <div className="section-label">
              <span>Conversation</span>
            </div>
            {conversationTurns ? (
              <div className="conversation-flow">
                {conversationTurns.map((turn, i) => (
                  <div key={i} className={`conversation-turn conversation-turn-${turn.role}`}>
                    <div className="conversation-turn-role">
                      {turn.role === 'user' ? 'You' : 'MixCraft'}
                    </div>
                    {turn.content}
                  </div>
                ))}
              </div>
            ) : data.conversationSummary ? (
              <div className="conversation-summary">
                {data.conversationSummary}
              </div>
            ) : null}
          </section>
        )}

        <section className="share-section">
          <div className="section-label">
            <span>Tracks</span>
          </div>
          <div className="share-track-list">
            {data.tracks.map((track, i) => (
              <div key={i} className="share-track-row">
                <span className="share-track-num">{i + 1}</span>
                <div className="share-track-info">
                  <div className="share-track-title">{track.title}</div>
                  <div className="share-track-artist">{track.artist}</div>
                </div>
                <span className="share-track-duration">{formatDuration(track.duration)}</span>
              </div>
            ))}
          </div>
        </section>

        <footer className="share-footer">
          <span className="footer-created">
            Shared on {new Date(data.createdAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
          </span>
          <span className="footer-branding">
            Created with <a href="https://mixcraft.app">MixCraft</a>
          </span>
        </footer>
      </main>
    </div>
  );
}

function ShareHeader() {
  return (
    <header className="share-header">
      <a href="https://mixcraft.app" className="share-wordmark">
        <span className="share-wordmark-icon">&#9835;</span>
        <span className="share-wordmark-text">MixCraft</span>
      </a>
      <a href="https://mixcraft.app" className="btn btn-secondary btn-sm">Get MixCraft</a>
    </header>
  );
}
