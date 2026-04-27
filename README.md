# Foobar DJ MCP Server

Stop settling for another "AI-to-Spotify" controller. If you've spent years curating a high-quality local music library, you deserve an AI that respects your bits.
<img width="1345" height="1012" alt="12121" src="https://github.com/user-attachments/assets/08bf373a-12e0-4a83-b812-574c2a0088ed" />


Foobar DJ is a [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server that connects Gemini (or any MCP-compatible agent) directly to your **Foobar2000** setup. There is something truly awesome about asking an AI to "dig through my 90s grunge" and having it shuffle up a pristine `.flac` library instead of a compressed stream.

## Why this exists?
- **No Cloud Required**: This is your music, on your hardware.
- **FLAC Support**: Because quality matters.
- **Local Intelligence**: The AI indexes your actual folder structure, recognizing your specific editions, box sets, and bootlegs.

## Setup

### 1. The Bridge (Beefweb)
This server uses the Beefweb REST API to talk to Foobar.
- Install the included `foo_beefweb-0.10.fb2k-component` in Foobar2000 (Preferences -> Components).
- Restart Foobar. It defaults to `http://localhost:8880`.

### 2. Install the Server
```bash
npm install
npm run build
```

### 3. Configure
Copy `.env.example` to `.env` and set your `MUSIC_LIBRARY_PATH`.

### 4. Connect to Gemini CLI
Add this to your `gemini-config.json`:

```json
{
  "mcpServers": {
    "foobar-dj": {
      "command": "node",
      "args": ["C:/Foobar-DJ-Repo/dist/index.js"]
    }
  }
}
```

## Tools Included
- `foobar_play_artist`: Shuffle a specific artist.
- `foobar_play_album`: Play a specific record.
- `foobar_search_library`: Find that one obscure b-side.
- `foobar_now_playing`: Get the stats on the current track.
- `foobar_create_playlist`: Let the AI act as a DJ and build a custom mix.

---
*Donated to the community. Keep your library local.*
