import { BasePlugin, Track, SearchResult, StreamInfo } from "ziplayer";
import { Readable } from "stream";
import { getTTSUrls } from "@zibot/zitts";
import axios from "axios";

export interface TTSPluginOptions {
	defaultLang?: string; // e.g., "vi" | "en"
	slow?: boolean;
	/**
	 * Optional custom TTS hook. If provided, it will be used to
	 * create the audio stream for the given text instead of the
	 * built-in Google TTS wrapper.
	 *
	 * Return one of:
	 * - Node Readable (preferred)
	 * - HTTP(S) URL string or URL object
	 * - Buffer / Uint8Array / ArrayBuffer
		\t * - Or an object with { stream, type } | { url, type }
	 */
	createStream?: (
		text: string,
		ctx?: { lang: string; slow: boolean; track?: Track },
	) =>
		| Promise<Readable | string | URL | Buffer | Uint8Array | ArrayBuffer>
		| Readable
		| string
		| URL
		| Buffer
		| Uint8Array
		| ArrayBuffer;
}

interface TTSConfig {
	text: string;
	lang: string;
	slow: boolean;
}

export class TTSPlugin extends BasePlugin {
	name = "tts";
	version = "1.0.0";
	private opts: { defaultLang: string; slow: boolean; createStream?: TTSPluginOptions["createStream"] };

	constructor(opts?: TTSPluginOptions) {
		super();
		this.opts = {
			defaultLang: opts?.defaultLang || "vi",
			slow: !!opts?.slow,
			createStream: opts?.createStream,
		};
	}

	canHandle(query: string): boolean {
		if (!query) return false;
		const q = query.trim().toLowerCase();
		return q.startsWith("tts:") || q.startsWith("say ");
	}

	async search(query: string, requestedBy: string): Promise<SearchResult> {
		if (!this.canHandle(query)) {
			return { tracks: [] };
		}
		const { text, lang, slow } = this.parseQuery(query);
		const config: TTSConfig = { text, lang, slow };
		const url = this.encodeConfig(config);
		const title = `TTS (${lang}${slow ? ", slow" : ""}): ${text.slice(0, 64)}${text.length > 64 ? "…" : ""}`;
		const estimatedSeconds = Math.max(1, Math.min(60, Math.ceil(text.length / 12)));

		const track: Track = {
			id: `tts-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
			title,
			url,
			duration: estimatedSeconds,
			requestedBy,
			source: this.name,
			metadata: { tts: config },
		};

		return { tracks: [track] };
	}

	async getStream(track: Track): Promise<StreamInfo> {
		const cfg = this.extractConfig(track);

		if (this.opts.createStream && typeof this.opts.createStream === "function") {
			const out = await this.opts.createStream(cfg.text, { lang: cfg.lang, slow: cfg.slow, track });
			let type: StreamInfo["type"] | undefined;
			let metadata: Record<string, any> | undefined;
			let stream: Readable | null = null;

			const normType = (t?: any): StreamInfo["type"] | undefined => {
				if (!t || typeof t !== "string") return undefined;
				const v = t.toLowerCase();
				if (v.includes("webm") && v.includes("opus")) return "webm/opus";
				if (v.includes("ogg") && v.includes("opus")) return "ogg/opus";
				return undefined;
			};

			if (out && typeof out === "object") {
				// If it's already a Readable/Buffer/Uint8Array/ArrayBuffer/URL, let toReadable handle it
				if (
					out instanceof Readable ||
					out instanceof Buffer ||
					out instanceof Uint8Array ||
					out instanceof ArrayBuffer ||
					out instanceof URL
				) {
					stream = await this.toReadable(out as any);
				} else if ((out as any).stream) {
					const o = out as any;
					stream = o.stream as Readable;
					type = normType(o.type);
					metadata = o.metadata;
				} else if ((out as any).url) {
					const o = out as any;
					const urlStr = o.url.toString();
					try {
						type =
							normType(o.type) ||
							(urlStr.endsWith(".webm") ? "webm/opus"
							: urlStr.endsWith(".ogg") ? "ogg/opus"
							: undefined);
						const res = await axios.get(urlStr, { responseType: "stream" });
						stream = res.data as unknown as Readable;
						metadata = o.metadata;
					} catch (e) {
						throw new Error(`Failed to fetch custom TTS URL: ${e}`);
					}
				}
			}

			if (!stream) {
				stream = await this.toReadable(out as any);
			}
			return { stream, type: type || "arbitrary", metadata: { provider: "custom", ...(metadata || {}) } };
		}

		const urls = getTTSUrls(cfg.text, { lang: cfg.lang, slow: cfg.slow });
		if (!urls || urls.length === 0) {
			throw new Error("TTS returned no audio URLs");
		}

		const parts = await Promise.all(
			urls.map((u) => axios.get<ArrayBuffer>(u, { responseType: "arraybuffer" }).then((r) => Buffer.from(r.data))),
		);

		const merged = Buffer.concat(parts);
		const stream = Readable.from([merged]);
		return { stream, type: "arbitrary", metadata: { size: merged.length } };
	}

	private async toReadable(out: Readable | string | URL | Buffer | Uint8Array | ArrayBuffer): Promise<Readable> {
		if (out instanceof Readable) return out;
		if (typeof out === "string" || out instanceof URL) {
			const url = out instanceof URL ? out.toString() : out;
			if (/^https?:\/\//i.test(url)) {
				const res = await axios.get(url, { responseType: "stream" });
				return res.data as unknown as Readable;
			}
			return Readable.from([Buffer.from(url)]);
		}
		if (out instanceof Buffer) return Readable.from([out]);
		if (out instanceof Uint8Array) return Readable.from([Buffer.from(out)]);
		if (out instanceof ArrayBuffer) return Readable.from([Buffer.from(out)]);
		throw new Error("Unsupported return type from createStream");
	}

	private parseQuery(query: string): TTSConfig {
		const isLangCode = (s: string) => /^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(s);

		const raw = query.trim();
		let text = raw;
		let lang = this.opts.defaultLang;
		let slow = this.opts.slow;

		const lower = raw.toLowerCase();
		if (lower.startsWith("say ")) {
			text = raw.slice(4).trim();
		} else if (lower.startsWith("tts:")) {
			const body = raw.slice(4).trim();
			// Supported:
			// - "tts: <text>" (text may contain colons)
			// - "tts:<lang>:<text>"
			// - "tts:<lang>:<slow>:<text>" where slow in {0,1,true,false}
			const firstSep = body.indexOf(":");
			if (firstSep === -1) {
				text = body;
			} else {
				const maybeLang = body.slice(0, firstSep).trim();
				const rest = body.slice(firstSep + 1).trim();
				if (isLangCode(maybeLang)) {
					lang = maybeLang;
					const secondSep = rest.indexOf(":");
					if (secondSep !== -1) {
						const maybeSlow = rest.slice(0, secondSep).trim().toLowerCase();
						const remaining = rest.slice(secondSep + 1).trim();
						if (["0", "1", "true", "false"].includes(maybeSlow)) {
							slow = maybeSlow === "1" || maybeSlow === "true";
							text = remaining;
						} else {
							text = rest;
						}
					} else {
						text = rest;
					}
				} else {
					text = body;
				}
			}
		}

		text = (text || "").trim();
		if (!text) throw new Error("No text provided for TTS");
		return { text, lang, slow };
	}

	private encodeConfig(cfg: TTSConfig): string {
		const payload = encodeURIComponent(JSON.stringify(cfg));
		return `tts://${payload}`;
	}

	private extractConfig(track: Track): TTSConfig {
		const meta = (track.metadata as any)?.tts as TTSConfig | undefined;
		if (meta && meta.text) return meta;
		try {
			const url = track.url || "";
			const encoded = url.startsWith("tts://") ? url.slice("tts://".length) : url;
			const cfg = JSON.parse(decodeURIComponent(encoded));
			return { text: cfg.text, lang: cfg.lang || this.opts.defaultLang, slow: !!cfg.slow };
		} catch {
			return { text: track.title || "", lang: this.opts.defaultLang, slow: this.opts.slow };
		}
	}
}
