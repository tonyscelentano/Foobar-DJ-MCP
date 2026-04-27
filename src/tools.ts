/**
 * MCP Tool definitions for Foobar DJ.
 * Each tool wraps Beefweb API calls and library indexer operations.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import * as beefweb from "./beefweb-client.js";
import {
  getLibrary,
  scanLibrary,
  searchLibrary,
  findAlbum,
  compactSummary,
} from "./library-indexer.js";

// ── Tool registration ──────────────────────────────────────────────────────

export function registerTools(server: McpServer): void {
  // ── Now Playing ──────────────────────────────────────────────────────────

  server.tool(
    "foobar_now_playing",
    "Get the currently playing track in Foobar2000 — artist, title, album, genre, playback position, duration, volume, and current playback mode. Returns nothing useful if playback is stopped.",
    {},
    async () => {
      try {
        const state = await beefweb.getPlayerState();
        const track = beefweb.parseTrackColumns(state.activeItem.columns);

        const info = {
          status: state.playbackState,
          playbackMode: state.playbackMode,
          playbackModeName: state.playbackModes?.[state.playbackMode] ?? "Unknown",
          artist: track.artist,
          title: track.title,
          album: track.album,
          genre: track.genre,
          date: track.date,
          length: track.length,
          position: Math.round(state.activeItem.position),
          duration: Math.round(state.activeItem.duration),
          volume: state.volume.value,
          isMuted: state.volume.isMuted,
        };

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(info, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error connecting to Foobar2000. Is it running with Beefweb installed? ${err}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // ── Playback Control ─────────────────────────────────────────────────────

  server.tool(
    "foobar_playback_control",
    "Control Foobar2000 playback. Actions: play, pause, stop, next, previous, play_random.",
    {
      action: z
        .enum(["play", "pause", "stop", "next", "previous", "play_random"])
        .describe("The playback action to perform"),
    },
    async ({ action }) => {
      try {
        const actions: Record<string, () => Promise<void>> = {
          play: beefweb.play,
          pause: beefweb.pause,
          stop: beefweb.stop,
          next: beefweb.next,
          previous: beefweb.previous,
          play_random: beefweb.playRandom,
        };

        await actions[action]();
        return {
          content: [
            { type: "text" as const, text: `✓ ${action} executed` },
          ],
        };
      } catch (err) {
        return {
          content: [
            { type: "text" as const, text: `Error: ${err}` },
          ],
          isError: true,
        };
      }
    }
  );

  // ── Volume ───────────────────────────────────────────────────────────────

  server.tool(
    "foobar_volume",
    "Adjust Foobar2000 volume. Use 'up' or 'down' for incremental ±5dB changes, or 'set' for an absolute dB value (range: typically -100 to 0).",
    {
      action: z
        .enum(["up", "down", "set"])
        .describe("Volume action"),
      value: z
        .number()
        .optional()
        .describe("Absolute dB value (only used with action 'set'). 0 = max, -100 = silent"),
    },
    async ({ action, value }) => {
      try {
        if (action === "up") await beefweb.volumeUp();
        else if (action === "down") await beefweb.volumeDown();
        else if (action === "set" && value !== undefined) {
          await beefweb.setVolume(value);
        } else {
          return {
            content: [
              { type: "text" as const, text: "Error: 'set' action requires a 'value' parameter" },
            ],
            isError: true,
          };
        }

        return {
          content: [
            {
              type: "text" as const,
              text: `✓ Volume ${action}${value !== undefined ? ` to ${value}dB` : ""}`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error: ${err}` }],
          isError: true,
        };
      }
    }
  );

  // ── Seek ─────────────────────────────────────────────────────────────────

  server.tool(
    "foobar_seek",
    "Seek to a specific position (in seconds) within the currently playing track.",
    {
      position: z
        .number()
        .describe("Position in seconds to seek to (e.g. 90 = 1:30)"),
    },
    async ({ position }) => {
      try {
        await beefweb.seek(position);
        const mins = Math.floor(position / 60);
        const secs = Math.floor(position % 60).toString().padStart(2, "0");
        return {
          content: [
            { type: "text" as const, text: `✓ Seeked to ${mins}:${secs}` },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error: ${err}` }],
          isError: true,
        };
      }
    }
  );

  // ── Shuffle Toggle ───────────────────────────────────────────────────────

  server.tool(
    "foobar_shuffle_toggle",
    "Toggle shuffle mode in Foobar2000. Switches between Default (linear playback, mode 0) and Shuffle (random, mode 3). Reports the new state.",
    {},
    async () => {
      try {
        const state = await beefweb.getPlayerState();
        const isShuffled = state.playbackMode === 3;
        const newMode = isShuffled ? 0 : 3;
        await beefweb.setPlaybackMode(newMode);
        return {
          content: [
            {
              type: "text" as const,
              text: `✓ Shuffle ${newMode === 3 ? "enabled" : "disabled"} (mode ${newMode})`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error: ${err}` }],
          isError: true,
        };
      }
    }
  );

  // ── Browse Library ───────────────────────────────────────────────────────

  server.tool(
    "foobar_browse_library",
    "Get the complete local music library catalog from C:\\Music. Returns all available artists, albums, and folder info. Use this to understand what music is available before making recommendations or playing tracks.",
    {},
    async () => {
      try {
        const index = await getLibrary();
        const summary = compactSummary(index);

        return {
          content: [{ type: "text" as const, text: summary }],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error scanning library: ${err}` }],
          isError: true,
        };
      }
    }
  );

  // ── Search Library ───────────────────────────────────────────────────────

  server.tool(
    "foobar_search_library",
    "Search the local music library by artist name, album name, or subfolder name. Results are ranked by relevance. Returns matching entries with full paths and all subfolders (albums).",
    {
      query: z.string().describe("Search term — matched against artist, album, and subfolder names"),
      limit: z.number().optional().describe("Maximum results to return (default: 20)"),
    },
    async ({ query, limit }) => {
      try {
        const index = await getLibrary();
        const results = searchLibrary(index, query, limit ?? 20);

        if (results.length === 0) {
          return {
            content: [
              { type: "text" as const, text: `No matches found for "${query}" in the library.` },
            ],
          };
        }

        const formatted = results.map((e) => ({
          artist: e.artist,
          album: e.album,
          year: e.year,
          path: e.path,
          type: e.type,
          subfolders: e.subfolders,
        }));

        return {
          content: [
            { type: "text" as const, text: JSON.stringify(formatted, null, 2) },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error: ${err}` }],
          isError: true,
        };
      }
    }
  );

  // ── Play Artist ──────────────────────────────────────────────────────────

  server.tool(
    "foobar_play_artist",
    "Find an artist in the library by name (scored fuzzy match), load their entire music folder into the DJ Mix playlist, and start playing. Use foobar_play_album instead when a specific album is requested.",
    {
      artist: z.string().describe("Artist name to search for and play"),
      shuffle: z.boolean().optional().describe("Enable shuffle mode after loading (default: false)"),
    },
    async ({ artist, shuffle }) => {
      try {
        const index = await getLibrary();
        const results = searchLibrary(index, artist, 5);

        if (results.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Could not find "${artist}" in the library. Try foobar_browse_library first.`,
              },
            ],
            isError: true,
          };
        }

        const match = results[0];

        const playlists = await beefweb.getPlaylists();
        let djPlaylist = playlists.find((p) => p.title === "DJ Mix");

        if (djPlaylist) {
          await beefweb.clearPlaylist(djPlaylist.id);
        } else {
          djPlaylist = await beefweb.createPlaylist("DJ Mix");
        }

        await beefweb.addPlaylistItems(djPlaylist.id, [match.path]);
        await new Promise((r) => setTimeout(r, 500));
        await beefweb.playItem(djPlaylist.id, 0);

        if (shuffle) {
          await beefweb.setPlaybackMode(3);
        }

        return {
          content: [
            {
              type: "text" as const,
              text: `🎵 Now playing: ${match.artist}${match.album ? ` — ${match.album}` : ""}\nLoaded from: ${match.path}\nPlaylist: DJ Mix${shuffle ? " (shuffle on)" : ""}`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error: ${err}` }],
          isError: true,
        };
      }
    }
  );

  // ── Play Track ───────────────────────────────────────────────────────────

  server.tool(
    "foobar_play_track",
    "Find and play a specific track from the library. Provide the track name, and optionally the artist name for better accuracy. Loads the exact track into DJ Mix and starts playing.",
    {
      track: z.string().describe("Track name to search for (e.g. 'Leave It Alone')"),
      artist: z.string().optional().describe("Artist name to narrow the match (recommended)"),
    },
    async ({ track, artist }) => {
      try {
        const { readdir } = await import("node:fs/promises");
        const { join, extname } = await import("node:path");

        const index = await getLibrary();
        let targetDirs = index.entries.map((e) => e.path);

        if (artist) {
          const matches = searchLibrary(index, artist, 3);
          if (matches.length > 0) {
            targetDirs = matches.map((m) => m.path);
          } else {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Could not find artist "${artist}" in the library. Try foobar_search_library.`,
                },
              ],
              isError: true,
            };
          }
        }

        const query = track.toLowerCase().replace(/[^a-z0-9]/g, "");
        let foundPath: string | null = null;

        async function findFile(dir: string): Promise<string | null> {
          try {
            const entries = await readdir(dir, { withFileTypes: true });
            for (const e of entries) {
              if (e.isDirectory()) {
                const res = await findFile(join(dir, e.name));
                if (res) return res;
              } else {
                const ext = extname(e.name).toLowerCase();
                if ([".mp3", ".flac", ".aac", ".ogg", ".m4a", ".wav", ".wma"].includes(ext)) {
                  const normalizedName = e.name.toLowerCase().replace(/[^a-z0-9]/g, "");
                  if (normalizedName.includes(query)) {
                    return join(dir, e.name);
                  }
                }
              }
            }
          } catch {
            // ignore access errors
          }
          return null;
        }

        for (const dir of targetDirs) {
          foundPath = await findFile(dir);
          if (foundPath) break;
        }

        if (!foundPath) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Could not find track "${track}"${artist ? ` by "${artist}"` : ""} in the library.`,
              },
            ],
            isError: true,
          };
        }

        const playlists = await beefweb.getPlaylists();
        let djPlaylist = playlists.find((p) => p.title === "DJ Mix");

        if (djPlaylist) {
          await beefweb.clearPlaylist(djPlaylist.id);
        } else {
          djPlaylist = await beefweb.createPlaylist("DJ Mix");
        }

        await beefweb.addPlaylistItems(djPlaylist.id, [foundPath]);
        await new Promise((r) => setTimeout(r, 500));
        await beefweb.playItem(djPlaylist.id, 0);

        return {
          content: [
            {
              type: "text" as const,
              text: `🎵 Now playing: ${track}\nLoaded file: ${foundPath}\nPlaylist: DJ Mix`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error: ${err}` }],
          isError: true,
        };
      }
    }
  );

  // ── Play Album ───────────────────────────────────────────────────────────

  server.tool(
    "foobar_play_album",
    "Find and play a specific album from the library by searching across all artist subfolders. Provide both artist and album for best accuracy; album alone works for unique titles. Loads the exact album folder into DJ Mix and starts playing.",
    {
      album: z.string().describe("Album name to search for"),
      artist: z
        .string()
        .optional()
        .describe("Artist name to narrow the match (recommended)"),
      shuffle: z
        .boolean()
        .optional()
        .describe("Enable shuffle mode after loading (default: false)"),
    },
    async ({ album, artist, shuffle }) => {
      try {
        const index = await getLibrary();
        const matches = findAlbum(index, album, artist);

        if (matches.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Could not find album "${album}"${artist ? ` by "${artist}"` : ""} in the library. Try foobar_search_library to browse available albums.`,
              },
            ],
            isError: true,
          };
        }

        const best = matches[0];

        const playlists = await beefweb.getPlaylists();
        let djPlaylist = playlists.find((p) => p.title === "DJ Mix");

        if (djPlaylist) {
          await beefweb.clearPlaylist(djPlaylist.id);
        } else {
          djPlaylist = await beefweb.createPlaylist("DJ Mix");
        }

        await beefweb.addPlaylistItems(djPlaylist.id, [best.albumPath]);
        await new Promise((r) => setTimeout(r, 500));
        await beefweb.playItem(djPlaylist.id, 0);

        if (shuffle) {
          await beefweb.setPlaybackMode(3);
        }

        const albumLabel = best.subfolder ?? best.entry.album ?? album;
        return {
          content: [
            {
              type: "text" as const,
              text: `🎵 Now playing: ${best.entry.artist} — ${albumLabel}\nLoaded from: ${best.albumPath}\nPlaylist: DJ Mix${shuffle ? " (shuffle on)" : ""}`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error: ${err}` }],
          isError: true,
        };
      }
    }
  );

  // ── Create Playlist ──────────────────────────────────────────────────────

  server.tool(
    "foobar_create_playlist",
    "Create a new Foobar2000 playlist and populate it with music from specified artists in the library.",
    {
      name: z.string().describe("Name for the new playlist"),
      artists: z
        .array(z.string())
        .describe("Array of artist names to search for and add to the playlist"),
    },
    async ({ name, artists }) => {
      try {
        const index = await getLibrary();
        const playlist = await beefweb.createPlaylist(name);

        const added: string[] = [];
        const notFound: string[] = [];

        for (const artist of artists) {
          const results = searchLibrary(index, artist, 3);
          if (results.length > 0) {
            await beefweb.addPlaylistItems(playlist.id, [results[0].path]);
            added.push(results[0].artist);
          } else {
            notFound.push(artist);
          }
        }

        await new Promise((r) => setTimeout(r, 500));

        if (added.length > 0) {
          await beefweb.playItem(playlist.id, 0);
        }

        let msg = `🎶 Created playlist "${name}" with ${added.length} artists:\n`;
        msg += added.map((a) => `  ✓ ${a}`).join("\n");
        if (notFound.length > 0) {
          msg += `\n\nNot found in library:\n`;
          msg += notFound.map((a) => `  ✗ ${a}`).join("\n");
        }

        return {
          content: [{ type: "text" as const, text: msg }],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error: ${err}` }],
          isError: true,
        };
      }
    }
  );

  // ── List Playlists ───────────────────────────────────────────────────────

  server.tool(
    "foobar_list_playlists",
    "List all current playlists in Foobar2000 with their names, item counts, and IDs.",
    {},
    async () => {
      try {
        const playlists = await beefweb.getPlaylists();

        const formatted = playlists.map((p) => ({
          title: p.title,
          id: p.id,
          itemCount: p.itemCount,
          isCurrent: p.isCurrent,
        }));

        return {
          content: [
            { type: "text" as const, text: JSON.stringify(formatted, null, 2) },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error: ${err}` }],
          isError: true,
        };
      }
    }
  );

  // ── Get Playlist Items ───────────────────────────────────────────────────

  server.tool(
    "foobar_get_playlist_items",
    "Get the tracks from a specific Foobar2000 playlist. Returns track metadata (artist, title, album, genre, duration).",
    {
      playlistId: z.string().describe("Playlist ID or index (use foobar_list_playlists to find IDs)"),
      offset: z.number().optional().describe("Start offset (default: 0)"),
      count: z.number().optional().describe("Number of items to return (default: 50, max: 200)"),
    },
    async ({ playlistId, offset, count }) => {
      try {
        const result = await beefweb.getPlaylistItems(
          playlistId,
          offset ?? 0,
          Math.min(count ?? 50, 200)
        );

        const tracks = result.playlistItems.items.map((item, i) => {
          const t = beefweb.parseTrackColumns(item.columns);
          return {
            index: (offset ?? 0) + i,
            artist: t.artist,
            title: t.title,
            album: t.album,
            genre: t.genre,
            length: t.length,
          };
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  totalCount: result.playlistItems.totalCount,
                  showing: tracks.length,
                  offset: offset ?? 0,
                  tracks,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error: ${err}` }],
          isError: true,
        };
      }
    }
  );

  // ── Rescan Library ───────────────────────────────────────────────────────

  server.tool(
    "foobar_rescan_library",
    "Re-scan C:\\Music and rebuild the cached library index. Use this after adding new music. The index auto-refreshes every 24 hours, but call this for immediate updates.",
    {},
    async () => {
      try {
        const index = await scanLibrary();
        return {
          content: [
            {
              type: "text" as const,
              text: `✓ Library rescanned: ${index.totalFolders} entries indexed from ${index.musicPath}`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error: ${err}` }],
          isError: true,
        };
      }
    }
  );
}
