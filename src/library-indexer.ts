/**
 * Library indexer — scans C:\Music folder structure,
 * parses artist/album/year from folder naming conventions,
 * and caches a compact JSON index for LLM consumption.
 */

import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { join, basename } from "node:path";
import { homedir } from "node:os";

// ── Types ──────────────────────────────────────────────────────────────────

export interface LibraryEntry {
  id: string;
  artist: string;
  album: string | null;
  year: number | null;
  path: string;
  type: "album" | "discography" | "artist" | "collection";
  subfolders: string[];
}

export interface LibraryIndex {
  version: number;
  scannedAt: string;
  musicPath: string;
  entries: LibraryEntry[];
  totalFolders: number;
}

export interface AlbumMatch {
  entry: LibraryEntry;
  /** Subfolder name within the artist folder, or null if the entry itself is the album */
  subfolder: string | null;
  /** Full resolved path to play */
  albumPath: string;
  /** Combined relevance score */
  score: number;
}

// ── Config ─────────────────────────────────────────────────────────────────

const MUSIC_PATH = process.env.MUSIC_LIBRARY_PATH || "C:\\Music";
const CACHE_DIR = join(homedir(), ".foobar-dj");
const CACHE_FILE = join(CACHE_DIR, "library-index.json");
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// ── Normalization ──────────────────────────────────────────────────────────

/**
 * Normalizes a string for fuzzy comparison:
 * lowercases, strips leading articles (the/a/an), removes non-alphanumeric chars.
 */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/^(the|a|an)\s+/i, "")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ── Scoring ────────────────────────────────────────────────────────────────

/**
 * Scores how well a query matches a library entry.
 * Returns 0 if no match.
 */
function scoreEntry(entry: LibraryEntry, q: string): number {
  const artist = normalize(entry.artist);
  const album = entry.album ? normalize(entry.album) : "";

  if (artist === q) return 100;
  if (album === q) return 95;
  if (artist.startsWith(q) || album.startsWith(q)) return 80;

  const qWords = q.split(/\s+/).filter((w) => w.length > 1);
  if (qWords.length > 1 && qWords.every((w) => artist.includes(w))) return 70;
  if (qWords.length > 1 && qWords.every((w) => album.includes(w))) return 65;

  if (artist.includes(q)) return 60;
  if (album.includes(q)) return 55;

  if (entry.subfolders.some((s) => normalize(s).includes(q))) return 35;

  return 0;
}

// ── Folder name parser ─────────────────────────────────────────────────────

/**
 * Parses folder names into structured metadata.
 * Handles common naming conventions found in music collections:
 *
 *   (2003) Three Days Grace - Three Days Grace (Expanded) [16Bit-44.1kHz]
 *   [1983] Kill 'Em All
 *   1990 - Violator (Sire~Reprise CD 26081)
 *   Foo Fighters - The Colour And The Shape
 *   ALL THAT REMAINS - DISCOGRAPHY (1998-15) [CHANNEL NEO]
 *   Blink-182
 *   Adema - Discography [5 Albums]
 */
function parseFolderName(name: string): Omit<LibraryEntry, "path" | "subfolders"> {
  const cleaned = name.trim();

  const isDiscography =
    /discography/i.test(cleaned) ||
    /\[\d+ Albums?\]/i.test(cleaned) ||
    /collection/i.test(cleaned);

  const stripped = cleaned
    .replace(/\[(?:16Bit|24Bit|24 Bit)[-\s]?\d+(?:\.\d+)?kHz\]/gi, "")
    .replace(/\[\d+kbps?\]/gi, "")
    .replace(/\(?\d{2,3}kbps?\)?/gi, "")
    .replace(/\[(?:FLAC|MP3|WAV|AAC|OGG|ALAC)\]/gi, "")
    .replace(/\[(?:Hi-Res|Hi Res)\]/gi, "")
    .replace(/\[PMEDIA\]/gi, "")
    .replace(/\[(?:CHANNEL NEO)\]/gi, "")
    .replace(/\[(?:VX|Hunter)\]/gi, "")
    .replace(/\((?:Japanese|JP|Asian|Deluxe|Expanded|Limited)\s*(?:Edition|Ed\.?)?\)/gi, "")
    .replace(/\(\d+(?:th|st|nd|rd)?\s*Anniversary[^)]*\)/gi, "")
    .replace(/⭐️/g, "")
    .replace(/\s*mp3\s*/gi, "")
    .replace(/\s*\(\s*\)\s*/g, "")
    .replace(/\s*\[\s*\]\s*/g, "")
    .trim();

  let artist = "";
  let album: string | null = null;
  let year: number | null = null;

  const p1 = stripped.match(/^\((\d{4})\)\s+(.+?)\s*-\s*(.+)$/);
  if (p1) {
    year = parseInt(p1[1]);
    artist = p1[2].trim();
    album = p1[3].trim();
    return { id: makeId(artist), artist, album, year, type: isDiscography ? "discography" : "album" };
  }

  const p2 = stripped.match(/^\[(\d{4})\]\s+(.+)$/);
  if (p2) {
    year = parseInt(p2[1]);
    album = p2[2].trim();
    artist = album;
    return { id: makeId(artist), artist, album, year, type: "album" };
  }

  const p3 = stripped.match(/^(\d{4})\s*-\s*(.+?)(?:\s*\(.*\))?\s*$/);
  if (p3) {
    year = parseInt(p3[1]);
    album = p3[2].trim();
    artist = album;
    return { id: makeId(artist), artist, album, year, type: "album" };
  }

  const p4 = stripped.match(/^(.+?)\s+- \s*(.+)$/);
  if (p4) {
    artist = p4[1].trim();
    album = p4[2]
      .replace(/\s*-?\s*Discography\b.*/i, "")
      .replace(/\s*\(.*\)\s*$/, "")
      .trim();

    if (isDiscography || !album) {
      album = null;
    }
    return {
      id: makeId(artist),
      artist,
      album: album || null,
      year,
      type: isDiscography ? "discography" : "album",
    };
  }

  artist = stripped
    .replace(/\s*-?\s*Discography\b.*/i, "")
    .replace(/\s*\(.*\)\s*$/, "")
    .replace(/\s*\[.*\]\s*$/, "")
    .trim();

  return {
    id: makeId(artist),
    artist: artist || cleaned,
    album: null,
    year: null,
    type: isDiscography ? "discography" : "artist",
  };
}

function makeId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// ── Scanner ────────────────────────────────────────────────────────────────

async function getSubfolders(dirPath: string): Promise<string[]> {
  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

export async function scanLibrary(): Promise<LibraryIndex> {
  const topFolders = await readdir(MUSIC_PATH, { withFileTypes: true });
  const dirs = topFolders.filter((e) => e.isDirectory());

  const entries: LibraryEntry[] = [];

  for (const dir of dirs) {
    if (dir.name.toLowerCase() === "playlists" || dir.name.startsWith(".")) {
      continue;
    }

    const fullPath = join(MUSIC_PATH, dir.name);
    const parsed = parseFolderName(dir.name);
    const subfolders = await getSubfolders(fullPath);

    entries.push({
      ...parsed,
      path: fullPath,
      subfolders,
    });
  }

  const index: LibraryIndex = {
    version: 1,
    scannedAt: new Date().toISOString(),
    musicPath: MUSIC_PATH,
    entries,
    totalFolders: entries.length,
  };

  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(CACHE_FILE, JSON.stringify(index, null, 2), "utf-8");

  return index;
}

// ── Cache management ───────────────────────────────────────────────────────

export async function getCachedLibrary(): Promise<LibraryIndex | null> {
  try {
    const raw = await readFile(CACHE_FILE, "utf-8");
    return JSON.parse(raw) as LibraryIndex;
  } catch {
    return null;
  }
}

export async function getLibrary(): Promise<LibraryIndex> {
  const cached = await getCachedLibrary();
  if (cached) {
    const ageMs = Date.now() - new Date(cached.scannedAt).getTime();
    if (ageMs < CACHE_TTL_MS) return cached;
  }
  return scanLibrary();
}

// ── Search ─────────────────────────────────────────────────────────────────

/**
 * Scored artist/album search. Results sorted by relevance descending.
 */
export function searchLibrary(
  index: LibraryIndex,
  query: string,
  limit = 20
): LibraryEntry[] {
  const q = normalize(query);
  return index.entries
    .map((e) => ({ entry: e, score: scoreEntry(e, q) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ entry }) => entry);
}

/**
 * Find a specific album across all entries by searching subfolders.
 * Optionally constrain to a specific artist.
 *
 * Returns matches sorted by combined relevance (album match weighted 2x artist).
 */
export function findAlbum(
  index: LibraryIndex,
  albumQuery: string,
  artistQuery?: string
): AlbumMatch[] {
  const aq = normalize(albumQuery);
  const artistQ = artistQuery ? normalize(artistQuery) : null;
  const results: AlbumMatch[] = [];

  for (const entry of index.entries) {
    // If artist is specified, pre-filter by artist match
    const artistScore = artistQ ? scoreEntry(entry, artistQ) : 50;
    if (artistQ && artistScore === 0) continue;

    // Search subfolders for album match
    for (const subfolder of entry.subfolders) {
      const sub = normalize(subfolder);
      let albumScore = 0;

      if (sub === aq) {
        albumScore = 100;
      } else if (sub.includes(aq)) {
        albumScore = 70;
      } else {
        const qWords = aq.split(/\s+/).filter((w) => w.length > 2);
        if (qWords.length > 0 && qWords.every((w) => sub.includes(w))) {
          albumScore = 60;
        }
      }

      if (albumScore > 0) {
        results.push({
          entry,
          subfolder,
          albumPath: join(entry.path, subfolder),
          score: albumScore + (artistQ ? artistScore / 2 : 0),
        });
      }
    }

    // Fallback: entry has no subfolders, match entry-level album field
    if (entry.subfolders.length === 0 && entry.album) {
      const entryAlbum = normalize(entry.album);
      let albumScore = 0;
      if (entryAlbum === aq) albumScore = 90;
      else if (entryAlbum.includes(aq)) albumScore = 60;
      if (albumScore > 0) {
        results.push({
          entry,
          subfolder: null,
          albumPath: entry.path,
          score: albumScore + (artistQ ? artistScore / 2 : 0),
        });
      }
    }
  }

  return results.sort((a, b) => b.score - a.score);
}

// ── LLM summary ───────────────────────────────────────────────────────────

/**
 * Returns a compact summary suitable for LLM context.
 * Minimizes token usage while preserving all decision-relevant info.
 */
export function compactSummary(index: LibraryIndex): string {
  const lines = index.entries.map((e) => {
    const parts = [e.artist];
    if (e.album && e.album !== e.artist) parts.push(`"${e.album}"`);
    if (e.year) parts.push(`(${e.year})`);
    if (e.type === "discography") parts.push("[full discography]");
    if (e.subfolders.length > 0 && e.type === "artist") {
      parts.push(`[${e.subfolders.length} albums]`);
    }
    return `- ${parts.join(" | ")}`;
  });

  return [
    `Music Library: ${index.totalFolders} entries in ${index.musicPath}`,
    `Scanned: ${index.scannedAt}`,
    "",
    ...lines,
  ].join("\n");
}
