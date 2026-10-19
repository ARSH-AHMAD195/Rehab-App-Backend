/** A YouTube video id: 11 characters of letters, digits, - and _. */
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

const HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
  'youtu.be',
]);

/** Path forms that carry the id as the next segment, e.g. /embed/<id>. */
const ID_PATHS = new Set(['embed', 'shorts', 'live', 'v', 'e']);

/**
 * The video id from whatever the admin pastes: a bare id, or a watch, share
 * (youtu.be), embed, shorts or live link. Returns null for anything else,
 * including links to playlists, channels or other sites.
 *
 * This only reads the link. Whether the video exists, is Unlisted/Public and
 * allows embedding is a separate check (not built yet - see the reference,
 * section 9, Videos).
 */
export function parseYouTubeVideoId(input: string): string | null {
  const value = input.trim();
  if (VIDEO_ID.test(value)) return value;

  let url: URL;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(value) ? value : `https://${value}`);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol) || !HOSTS.has(url.hostname.toLowerCase())) return null;

  const segments = url.pathname.split('/').filter(Boolean);
  let id: string | null | undefined;
  if (url.hostname.toLowerCase() === 'youtu.be') id = segments[0];
  else if (segments[0] === 'watch') id = url.searchParams.get('v');
  else if (ID_PATHS.has(segments[0] ?? '')) id = segments[1];

  return id && VIDEO_ID.test(id) ? id : null;
}

/** The link the app and the admin screen show for a stored id. */
export function youTubeWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}
