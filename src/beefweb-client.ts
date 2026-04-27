/**
 * Beefweb REST API client for Foobar2000.
 * Wraps the Beefweb HTTP endpoints (default: localhost:8880).
 */

const BEEFWEB_URL = process.env.BEEFWEB_URL || "http://localhost:8880";
const BEEFWEB_USER = process.env.BEEFWEB_USER || "GoogleFlash";
const BEEFWEB_PASS = process.env.BEEFWEB_PASS || "djextension";

// ── Types ──────────────────────────────────────────────────────────────────

export interface ActiveItemInfo {
  playlistId: string;
  playlistIndex: number;
  index: number;
  position: number;
  duration: number;
  columns: string[];
}

export interface VolumeInfo {
  type: string;
  min: number;
  max: number;
  value: number;
  isMuted: boolean;
}

export interface PlayerState {
  playbackState: "stopped" | "playing" | "paused";
  playbackMode: number;
  playbackModes: string[];
  activeItem: ActiveItemInfo;
  volume: VolumeInfo;
}

export interface PlaylistInfo {
  id: string;
  index: number;
  title: string;
  isCurrent: boolean;
  itemCount: number;
  totalTime: number;
}

export interface PlaylistItemsResponse {
  playlistItems: {
    items: Array<{ columns: string[] }>;
    offset: number;
    totalCount: number;
  };
}

// ── Standard metadata columns we request ───────────────────────────────────

const TRACK_COLUMNS = [
  "%artist%",
  "%title%",
  "%album%",
  "%genre%",
  "%length%",
  "%date%",
  "%tracknumber%",
  "%path%",
];

// ── HTTP helpers ───────────────────────────────────────────────────────────

async function api(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const url = `${BEEFWEB_URL}/api${path}`;
  const authHeader =
    "Basic " + Buffer.from(`${BEEFWEB_USER}:${BEEFWEB_PASS}`).toString("base64");
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: authHeader,
      ...options.headers,
    },
  });
  if (!res.ok && res.status !== 204 && res.status !== 202) {
    const body = await res.text().catch(() => "");
    throw new Error(`Beefweb ${res.status} ${res.statusText}: ${body}`);
  }
  return res;
}

async function apiGet<T>(path: string): Promise<T> {
  const res = await api(path);
  return res.json() as Promise<T>;
}

async function apiPost(path: string, body?: unknown): Promise<void> {
  await api(path, {
    method: "POST",
    body: body ? JSON.stringify(body) : undefined,
  });
}

// ── Client ─────────────────────────────────────────────────────────────────

export async function getPlayerState(): Promise<PlayerState> {
  const columns = TRACK_COLUMNS.join(",");
  const data = await apiGet<{ player: PlayerState }>(
    `/player?columns=${encodeURIComponent(columns)}`
  );
  return data.player;
}

export async function isAlive(): Promise<boolean> {
  try {
    await api("/player", { signal: AbortSignal.timeout(2000) });
    return true;
  } catch {
    return false;
  }
}

// ── Playback control ───────────────────────────────────────────────────────

export async function play(): Promise<void> {
  await apiPost("/player/play");
}

export async function playItem(
  playlistId: string | number,
  index: number
): Promise<void> {
  await apiPost(`/player/play/${playlistId}/${index}`);
}

export async function playRandom(): Promise<void> {
  await apiPost("/player/play/random");
}

export async function pause(): Promise<void> {
  await apiPost("/player/pause/toggle");
}

export async function stop(): Promise<void> {
  await apiPost("/player/stop");
}

export async function next(): Promise<void> {
  await apiPost("/player/next");
}

export async function previous(): Promise<void> {
  await apiPost("/player/previous");
}

export async function seek(positionSeconds: number): Promise<void> {
  await apiPost("/player", { position: positionSeconds });
}

// ── Volume ─────────────────────────────────────────────────────────────────

export async function setVolume(dbValue: number): Promise<void> {
  await apiPost("/player", { volume: dbValue });
}

export async function volumeUp(delta = 5): Promise<void> {
  const state = await getPlayerState();
  await setVolume(Math.min(0, state.volume.value + delta));
}

export async function volumeDown(delta = 5): Promise<void> {
  const state = await getPlayerState();
  await setVolume(Math.max(state.volume.min, state.volume.value - delta));
}

// ── Playback mode ──────────────────────────────────────────────────────────
// Standard Beefweb mode indices:
//   0 = Default (linear)
//   1 = Repeat playlist
//   2 = Repeat track
//   3 = Shuffle (random)
//   4 = Shuffle albums
//   5 = Shuffle folders

export async function setPlaybackMode(mode: number): Promise<void> {
  await apiPost("/player", { playbackMode: mode });
}

// ── Playlists ──────────────────────────────────────────────────────────────

export async function getPlaylists(): Promise<PlaylistInfo[]> {
  const data = await apiGet<{ playlists: PlaylistInfo[] }>("/playlists");
  return data.playlists;
}

export async function getPlaylistItems(
  playlistId: string | number,
  offset: number,
  count: number
): Promise<PlaylistItemsResponse> {
  const columns = TRACK_COLUMNS.join(",");
  return apiGet<PlaylistItemsResponse>(
    `/playlists/${playlistId}/items/${offset}:${count}?columns=${encodeURIComponent(columns)}`
  );
}

export async function createPlaylist(title: string): Promise<PlaylistInfo> {
  const res = await api("/playlists/add", {
    method: "POST",
    body: JSON.stringify({ title }),
  });
  return res.json() as Promise<PlaylistInfo>;
}

export async function addPlaylistItems(
  playlistId: string | number,
  items: string[]
): Promise<void> {
  await apiPost(`/playlists/${playlistId}/items/add`, {
    items,
    async: true,
  });
}

export async function clearPlaylist(
  playlistId: string | number
): Promise<void> {
  await apiPost(`/playlists/${playlistId}/clear`);
}

// ── Artwork ────────────────────────────────────────────────────────────────

export function getArtworkUrl(
  playlistId?: string | number,
  index?: number
): string {
  if (playlistId != null && index != null) {
    return `${BEEFWEB_URL}/api/artwork/${playlistId}/${index}`;
  }
  return `${BEEFWEB_URL}/api/artwork/current`;
}

// ── Column parsing helper ──────────────────────────────────────────────────

export function parseTrackColumns(columns: string[]): {
  artist: string;
  title: string;
  album: string;
  genre: string;
  length: string;
  date: string;
  trackNumber: string;
  path: string;
} {
  return {
    artist: columns[0] || "Unknown",
    title: columns[1] || "Unknown",
    album: columns[2] || "Unknown",
    genre: columns[3] || "",
    length: columns[4] || "",
    date: columns[5] || "",
    trackNumber: columns[6] || "",
    path: columns[7] || "",
  };
}
