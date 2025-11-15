import { BasePlugin, Track, SearchResult, StreamInfo } from "ziplayer";

/**
 * This minimal Spotify plugin:
 * - Parses Spotify URLs/URIs (track/playlist/album)
 * - Uses Spotify's public oEmbed endpoint to fetch *display metadata* (no auth, no SDK)
 * - Does NOT provide audio streams (player is expected to redirect/fallback upstream)
 * - Does NOT expand playlists/albums (no SDK; oEmbed doesn't enumerate items)
 */
export class SpotifyPlugin extends BasePlugin {
	name = "spotify";
	version = "1.1.0";

	canHandle(query: string): boolean {
		const q = query.toLowerCase().trim();
		if (q.startsWith("spotify:")) return true;
		try {
			const u = new URL(q);
			return u.hostname === "open.spotify.com";
		} catch {
			return false;
		}
	}

	validate(url: string): boolean {
		if (url.startsWith("spotify:")) return true;
		try {
			const u = new URL(url);
			return u.hostname === "open.spotify.com";
		} catch {
			return false;
		}
	}

	async search(query: string, requestedBy: string): Promise<SearchResult> {
		if (!this.validate(query)) {
			return { tracks: [] };
		}

		const kind = this.identifyKind(query);

		if (kind === "track") {
			const t = await this.buildTrackFromUrlOrUri(query, requestedBy);
			return { tracks: t ? [t] : [] };
		}

		if (kind === "playlist") {
			const t = await this.buildHeaderItem(query, requestedBy, "playlist");
			return { tracks: t ? [t] : [] };
		}

		if (kind === "album") {
			const t = await this.buildHeaderItem(query, requestedBy, "album");
			return { tracks: t ? [t] : [] };
		}

		return { tracks: [] };
	}

	async extractPlaylist(_input: string, _requestedBy: string): Promise<Track[]> {
		return [];
	}

	async extractAlbum(_input: string, _requestedBy: string): Promise<Track[]> {
		return [];
	}

	async getStream(_track: Track): Promise<StreamInfo> {
		throw new Error("Spotify streaming is not supported by this plugin");
	}

	private identifyKind(input: string): "track" | "playlist" | "album" | "unknown" {
		if (input.startsWith("spotify:")) {
			if (input.includes(":track:")) return "track";
			if (input.includes(":playlist:")) return "playlist";
			if (input.includes(":album:")) return "album";
			return "unknown";
		}
		try {
			const u = new URL(input);
			const parts = u.pathname.split("/").filter(Boolean);
			const kind = parts[0];
			if (kind === "track") return "track";
			if (kind === "playlist") return "playlist";
			if (kind === "album") return "album";
			return "unknown";
		} catch {
			return "unknown";
		}
	}

	private extractId(input: string): string | null {
		if (!input) return null;
		if (input.startsWith("spotify:")) {
			const parts = input.split(":");
			return parts[2] || null;
		}
		try {
			const u = new URL(input);
			const parts = u.pathname.split("/").filter(Boolean);
			return parts[1] || null; // /track/<id>
		} catch {
			return null;
		}
	}

	private async buildTrackFromUrlOrUri(input: string, requestedBy: string): Promise<Track | null> {
		const id = this.extractId(input);
		if (!id) return null;

		const url = this.toShareUrl(input, "track", id);
		const meta = await this.fetchOEmbed(url).catch(() => undefined);
		const title = meta?.title || `Spotify Track ${id}`;
		const thumbnail = meta?.thumbnail_url;

		const track: Track = {
			id,
			title,
			url,
			duration: 0,
			thumbnail,
			requestedBy,
			source: this.name,
			metadata: {
				author: meta?.author_name,
				provider: meta?.provider_name,
				spotify_id: id,
			},
		};
		return track;
	}

	private async buildHeaderItem(input: string, requestedBy: string, kind: "playlist" | "album"): Promise<Track | null> {
		const id = this.extractId(input);
		if (!id) return null;
		const url = this.toShareUrl(input, kind, id);
		const meta = await this.fetchOEmbed(url).catch(() => undefined);

		const title = meta?.title || `Spotify ${kind} ${id}`;
		const thumbnail = meta?.thumbnail_url;

		return {
			id,
			title,
			url,
			duration: 0,
			thumbnail,
			requestedBy,
			source: this.name,
			metadata: {
				author: meta?.author_name,
				provider: meta?.provider_name,
				spotify_id: id,
				kind,
			},
		};
	}

	private toShareUrl(input: string, expectedKind: string, id: string): string {
		if (input.startsWith("spotify:")) {
			return `https://open.spotify.com/${expectedKind}/${id}`;
		}
		try {
			const u = new URL(input);
			const parts = u.pathname.split("/").filter(Boolean);
			const kind = parts[0] || expectedKind;
			const realId = parts[1] || id;
			return `https://open.spotify.com/${kind}/${realId}`;
		} catch {
			return `https://open.spotify.com/${expectedKind}/${id}`;
		}
	}

	private async fetchOEmbed(pageUrl: string): Promise<{
		title?: string;
		thumbnail_url?: string;
		provider_name?: string;
		author_name?: string;
	}> {
		const endpoint = `https://open.spotify.com/oembed?url=${encodeURIComponent(pageUrl)}`;
		const res = await fetch(endpoint);
		if (!res.ok) throw new Error(`oEmbed HTTP ${res.status}`);
		return res.json() as Promise<{
			title?: string;
			thumbnail_url?: string;
			provider_name?: string;
			author_name?: string;
		}>;
	}
}
