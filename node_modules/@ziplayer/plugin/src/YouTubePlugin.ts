import { BasePlugin, Track, SearchResult, StreamInfo } from "ziplayer";

import { Innertube, Log } from "youtubei.js";

export class YouTubePlugin extends BasePlugin {
	name = "youtube";
	version = "1.0.0";

	private client!: Innertube;
	private searchClient!: Innertube;
	private ready: Promise<void>;

	constructor() {
		super();
		this.ready = this.init();
	}

	private async init(): Promise<void> {
		this.client = await Innertube.create({
			client_type: "ANDROID",
			retrieve_player: false,
		} as any);

		// Use a separate web client for search to avoid mobile parser issues
		this.searchClient = await Innertube.create({
			client_type: "WEB",
			retrieve_player: false,
		} as any);
		Log.setLevel(0);
	}

	// Build a Track from various YouTube object shapes (search item, playlist item, watch_next feed, basic_info, info)
	private buildTrack(raw: any, requestedBy: string, extra?: { playlist?: string }): Track {
		const pickFirst = (...vals: any[]) => vals.find((v) => v !== undefined && v !== null && v !== "");

		// Try to resolve from multiple common shapes
		const id = pickFirst(
			raw?.id,
			raw?.video_id,
			raw?.videoId,
			raw?.content_id,
			raw?.identifier,
			raw?.basic_info?.id,
			raw?.basic_info?.video_id,
			raw?.basic_info?.videoId,
			raw?.basic_info?.content_id,
		);

		const title = pickFirst(
			raw?.metadata?.title?.text,
			raw?.title?.text,
			raw?.title,
			raw?.headline,
			raw?.basic_info?.title,
			"Unknown title",
		);

		const durationValue = pickFirst(
			raw?.length_seconds,
			raw?.duration?.seconds,
			raw?.duration?.text,
			raw?.duration,
			raw?.length_text,
			raw?.basic_info?.duration,
		);
		const duration = Number(toSeconds(durationValue)) || 0;

		const thumb = pickFirst(
			raw?.thumbnails?.[0]?.url,
			raw?.thumbnail?.[0]?.url,
			raw?.thumbnail?.url,
			raw?.thumbnail?.thumbnails?.[0]?.url,
			raw?.content_image?.image?.[0]?.url,
			raw?.basic_info?.thumbnail?.[0]?.url,
			raw?.basic_info?.thumbnail?.[raw?.basic_info?.thumbnail?.length - 1]?.url,
			raw?.thumbnails?.[raw?.thumbnails?.length - 1]?.url,
		);

		const author = pickFirst(raw?.author?.name, raw?.author, raw?.channel?.name, raw?.owner?.name, raw?.basic_info?.author);

		const views = pickFirst(
			raw?.view_count,
			raw?.views,
			raw?.short_view_count,
			raw?.stats?.view_count,
			raw?.basic_info?.view_count,
		);

		const url = pickFirst(raw?.url, id ? `https://www.youtube.com/watch?v=${id}` : undefined);

		return {
			id: String(id),
			title: String(title),
			url: String(url),
			duration,
			thumbnail: thumb,
			requestedBy,
			source: this.name,
			metadata: {
				author,
				views,
				...(extra?.playlist ? { playlist: extra.playlist } : {}),
			},
		} as Track;
	}

	canHandle(query: string): boolean {
		const q = (query || "").trim().toLowerCase();
		const isUrl = q.startsWith("http://") || q.startsWith("https://");
		if (isUrl) {
			try {
				const parsed = new URL(query);
				const allowedHosts = ["youtube.com", "www.youtube.com", "music.youtube.com", "youtu.be", "www.youtu.be"];
				return allowedHosts.includes(parsed.hostname.toLowerCase());
			} catch (e) {
				return false;
			}
		}

		// Avoid intercepting explicit patterns for other extractors
		if (q.startsWith("tts:") || q.startsWith("say ")) return false;
		if (q.startsWith("spotify:") || q.includes("open.spotify.com")) return false;
		if (q.includes("soundcloud")) return false;

		// Treat remaining non-URL free text as YouTube-searchable
		return true;
	}

	validate(url: string): boolean {
		try {
			const parsed = new URL(url);
			const allowedHosts = ["youtube.com", "www.youtube.com", "music.youtube.com", "youtu.be", "www.youtu.be", "m.youtube.com"];
			return allowedHosts.includes(parsed.hostname.toLowerCase());
		} catch (e) {
			return false;
		}
	}

	async search(query: string, requestedBy: string): Promise<SearchResult> {
		await this.ready;

		if (this.validate(query)) {
			const listId = this.extractListId(query);
			if (listId) {
				if (this.isMixListId(listId)) {
					const anchorVideoId = this.extractVideoId(query);
					if (anchorVideoId) {
						try {
							const info: any = await (this.searchClient as any).getInfo(anchorVideoId);
							const feed: any[] = info?.watch_next_feed || [];
							const tracks: Track[] = feed
								.filter((tr: any) => tr?.content_type === "VIDEO")
								.map((v: any) => this.buildTrack(v, requestedBy, { playlist: listId }));
							const { basic_info } = info;

							const currTrack = this.buildTrack(basic_info, requestedBy);
							tracks.unshift(currTrack);
							return {
								tracks,
								playlist: { name: "YouTube Mix", url: query, thumbnail: tracks[0]?.thumbnail },
							};
						} catch {
							// ignore and fall back to normal playlist handling below
						}
					}
				}
				try {
					const playlist: any = await (this.searchClient as any).getPlaylist(listId);
					const videos: any[] = playlist?.videos || playlist?.items || [];
					const tracks: Track[] = videos.map((v: any) => this.buildTrack(v, requestedBy, { playlist: listId }));

					return {
						tracks,
						playlist: {
							name: playlist?.title || playlist?.metadata?.title || `Playlist ${listId}`,
							url: query,
							thumbnail: playlist?.thumbnails?.[0]?.url || playlist?.thumbnail?.url,
						},
					};
				} catch {
					const withoutList = query.replace(/[?&]list=[^&]+/, "").replace(/[?&]$/, "");
					return await this.search(withoutList, requestedBy);
				}
			}

			const videoId = this.extractVideoId(query);
			if (!videoId) throw new Error("Invalid YouTube URL");

			const info = await this.client.getBasicInfo(videoId);
			const track = this.buildTrack(info, requestedBy);
			return { tracks: [track] };
		}

		// Text search → return up to 10 video tracks
		const res: any = await this.searchClient.search(query, {
			type: "video" as any,
		});
		const items: any[] = res?.items || res?.videos || res?.results || [];

		const tracks: Track[] = items.slice(0, 10).map((v: any) => this.buildTrack(v, requestedBy));

		return { tracks };
	}

	async extractPlaylist(url: string, requestedBy: string): Promise<Track[]> {
		await this.ready;

		const listId = this.extractListId(url);
		if (!listId) return [];

		try {
			// Attempt to handle dynamic Mix playlists via watch_next feed
			if (this.isMixListId(listId)) {
				const anchorVideoId = this.extractVideoId(url);
				if (anchorVideoId) {
					try {
						const info: any = await (this.searchClient as any).getInfo(anchorVideoId);
						const feed: any[] = info?.watch_next_feed || [];
						return feed
							.filter((tr: any) => tr?.content_type === "VIDEO")
							.map((v: any) => this.buildTrack(v, requestedBy, { playlist: listId }));
					} catch {}
				}
			}

			const playlist: any = await (this.client as any).getPlaylist(listId);
			const videos: any[] = playlist?.videos || playlist?.items || [];
			return videos.map((v: any) => {
				return this.buildTrack(v, requestedBy, { playlist: listId }); //ack;
			});
		} catch {
			return [];
		}
	}

	async getStream(track: Track): Promise<StreamInfo> {
		await this.ready;

		const id = this.extractVideoId(track.url) || track.id;

		if (!id) throw new Error("Invalid track id");

		try {
			const stream: any = await (this.client as any).download(id, {
				type: "audio",
				quality: "best",
			});
			return {
				stream,
				type: "arbitrary",
				metadata: track.metadata,
			};
		} catch (e: any) {
			try {
				const info: any = await (this.client as any).getBasicInfo(id);

				// Prefer m4a audio-only formats first
				let format: any = info?.chooseFormat?.({
					type: "audio",
					quality: "best",
				});
				if (!format && info?.formats?.length) {
					const audioOnly = info.formats.filter((f: any) => f.mime_type?.includes("audio"));
					audioOnly.sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0));
					format = audioOnly[0];
				}

				if (!format) throw new Error("No audio format available");

				let url: string | undefined = undefined;
				if (typeof format.decipher === "function") {
					url = format.decipher((this.client as any).session.player);
				}
				if (!url) url = format.url;

				if (!url) throw new Error("No valid URL to decipher");
				const res = await fetch(url);

				if (!res.ok || !res.body) {
					throw new Error(`HTTP ${res.status}`);
				}

				return {
					stream: res.body as any,
					type: "arbitrary",
					metadata: {
						...track.metadata,
						itag: format.itag,
						mime: format.mime_type,
					},
				};
			} catch (inner: any) {
				throw new Error(`Failed to get YouTube stream: ${inner?.message || inner}`);
			}
		}
	}

	async getRelatedTracks(trackURL: string, opts: { limit?: number; offset?: number; history?: Track[] } = {}): Promise<Track[]> {
		await this.ready;
		const videoId = this.extractVideoId(trackURL);
		if (!videoId) {
			// If the last track URL is not a direct video URL (e.g., playlist URL),
			// we cannot fetch related videos reliably.
			return [];
		}
		const info: any = await await (this.searchClient as any).getInfo(videoId);
		const related: any[] = info?.watch_next_feed || [];
		const offset = opts.offset ?? 0;
		const limit = opts.limit ?? 5;

		const relatedfilter = related.filter(
			(tr: any) => tr.content_type === "VIDEO" && !(opts?.history ?? []).some((t) => t.url === tr.url),
		);

		return relatedfilter.slice(offset, offset + limit).map((v: any) => this.buildTrack(v, "auto"));
	}

	async getFallback(track: Track): Promise<StreamInfo> {
		try {
			const result = await this.search(track.title, track.requestedBy);
			const first = result.tracks[0];
			if (!first) throw new Error("No fallback track found");
			return await this.getStream(first);
		} catch (e: any) {
			throw new Error(`YouTube fallback search failed: ${e?.message || e}`);
		}
	}

	private extractVideoId(input: string): string | null {
		try {
			const u = new URL(input);
			const allowedShortHosts = ["youtu.be"];
			const allowedLongHosts = ["youtube.com", "www.youtube.com", "music.youtube.com", "m.youtube.com"];
			if (allowedShortHosts.includes(u.hostname)) {
				return u.pathname.split("/").filter(Boolean)[0] || null;
			}
			if (allowedLongHosts.includes(u.hostname)) {
				// watch?v=, shorts/, embed/
				if (u.searchParams.get("v")) return u.searchParams.get("v");
				const path = u.pathname;
				if (path.startsWith("/shorts/")) return path.replace("/shorts/", "");
				if (path.startsWith("/embed/")) return path.replace("/embed/", "");
			}
			return null;
		} catch {
			return null;
		}
	}

	private isMixListId(listId: string): boolean {
		// YouTube dynamic mixes typically start with 'RD'
		return typeof listId === "string" && listId.toUpperCase().startsWith("RD");
	}

	private extractListId(input: string): string | null {
		try {
			const u = new URL(input);
			return u.searchParams.get("list");
		} catch {
			return null;
		}
	}
}
function toSeconds(d: any): number | undefined {
	if (typeof d === "number") return d;
	if (typeof d === "string") {
		// mm:ss or hh:mm:ss
		const parts = d.split(":").map(Number);
		if (parts.some((n) => Number.isNaN(n))) return undefined;
		if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
		if (parts.length === 2) return parts[0] * 60 + parts[1];
		const asNum = Number(d);
		return Number.isFinite(asNum) ? asNum : undefined;
	}
	if (d && typeof d === "object") {
		if (typeof (d as any).seconds === "number") return (d as any).seconds;
		if (typeof (d as any).milliseconds === "number") return Math.floor((d as any).milliseconds / 1000);
	}
	return undefined;
}
