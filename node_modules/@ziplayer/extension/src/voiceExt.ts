import { BaseExtension, Player, PlayerManager } from "ziplayer";

const { Transform } = require("stream");
const prism = require("prism-media");
const axios = require("axios");

type OnVoiceChangeHook = (ctx: {
	userId: string;
	channelId: string;
	guildId: string;
	player: Player | null;
	manager?: PlayerManager;
	client?: any;
	current: SpeechOptions;
}) => Promise<Partial<SpeechOptions> | void> | Partial<SpeechOptions> | void;

interface SpeechOptions {
	ignoreBots: boolean;
	focusUser?: string;
	minimalVoiceMessageDuration: number; // seconds
	lang: string;
	key?: string;
	profanityFilter?: boolean;
	// How long to wait after silence before sending to STT (ms)
	postSilenceDelayMs?: number;
	// Middleware-like hook to adjust options per speaking session
	onVoiceChange?: OnVoiceChangeHook;
	// Optional custom speech resolver; receives mono 48kHz 16-bit PCM
	resolveSpeech?: (monoBuffer: Buffer, opts: SpeechOptions) => Promise<string> | string;
}

class PcmStream extends Transform {
	private buffer: Buffer;
	constructor(options?: any) {
		super(options);
		this.buffer = Buffer.alloc(0);
	}

	_transform(chunk: Buffer, _encoding: BufferEncoding, callback: Function) {
		this.buffer = Buffer.concat([this.buffer, chunk]);
		const fittingChunkSize = Math.floor(this.buffer.length / 2) * 2;
		if (fittingChunkSize > 0) {
			this.push(this.buffer.slice(0, fittingChunkSize));
			this.buffer = this.buffer.slice(fittingChunkSize);
		}
		callback();
	}

	_flush(callback: Function) {
		if (this.buffer.length > 0) {
			this.push(this.buffer);
		}
		callback();
	}
}

export class voiceExt extends BaseExtension {
	name = "voiceExt";
	version = "1.0.0";
	player: Player | null = null;
	private manager?: PlayerManager;

	private client?: any;
	private speechOptions: SpeechOptions;
	private _speakingEmitter?: any;
	private _speakingAttached = false;
	// private _activeSpeakers = new Set<string>();

	constructor(player: Player | null = null, opts?: Partial<SpeechOptions> & { client?: any }) {
		super();
		this.player = player;
		this.client = opts?.client;
		this.speechOptions = {
			ignoreBots: true,
			minimalVoiceMessageDuration: 1,
			lang: "vi-VN",
			profanityFilter: false,
			postSilenceDelayMs: 2000,
			...opts,
		} as SpeechOptions;
	}

	active(alas: any): boolean {
		if (alas?.player && !this.player) this.player = alas.player;
		const player = this.player;
		const manager = alas?.manager as PlayerManager | undefined;
		if (manager) this.manager = manager;
		const client = alas?.client ?? this.client;
		if (client && !this.client) this.client = client;

		if (!player) return false;

		const anyPlayer: any = player as any;
		if (!anyPlayer.__voiceExtWrappedConnect) {
			anyPlayer.__voiceExtWrappedConnect = true;
			const originalConnect = player.connect.bind(player);
			(player as any).connect = async (channel: any) => {
				const conn = await originalConnect(channel);
				try {
					this.attach(this.client);
				} catch (e: any) {
					this.debug(`attach error: ${e?.message || e}`);
				}
				return conn;
			};
		}

		if ((player as any).connection) {
			try {
				this.attach(this.client);
			} catch {}
		}

		return true;
	}

	attach(client?: any, opts?: Partial<SpeechOptions>) {
		if (client) this.client = client;
		if (opts) this.speechOptions = { ...this.speechOptions, ...opts } as SpeechOptions;
		const connection = this.player?.connection as any;
		if (!this.player || !connection) {
			throw new Error("voiceExt.attach requires a connected player");
		}

		// Set up speaking handler
		this.handleSpeakingEvent();

		// Auto-clean on destroy
		this.player.on("playerDestroy", () => {
			try {
				const conn = (this.player as any)?.connection;
				conn?.receiver?.speaking?.removeAllListeners?.();
				this._speakingAttached = false;
				this._speakingEmitter = undefined;
				// this._activeSpeakers.clear();
			} catch {}
		});
	}

	private debug(message: string) {
		this.player?.emit("debug", `[voiceExt] ${message}`);
	}

	private handleSpeakingEvent() {
		const connection = (this.player as any)?.connection;
		if (!connection) {
			this.debug("No connection found on player to attach receiver");
			return;
		}
		this.debug("Listening for speaking events");
		const speaking = connection.receiver?.speaking;
		if (!speaking || typeof speaking.on !== "function") {
			this.debug("No speaking emitter on connection.receiver");
			return;
		}

		// Re-attach only if emitter changed; otherwise guard against duplicates
		if (this._speakingEmitter !== speaking) {
			this._speakingEmitter = speaking;
			this._speakingAttached = false;
		}
		if (this._speakingAttached) return;
		this._speakingAttached = true;

		speaking.on("start", (userId: string) => {
			this.debug(`User ${userId} started speaking`);

			// Optional bot/user focus checks if client present
			if (this.client) {
				const user = this.client.users?.cache?.get?.(userId);
				if (!user) {
					this.debug(`Could not resolve user ${userId}`);
				} else {
					if (this.speechOptions.ignoreBots && user.bot) {
						this.debug(`Ignoring bot user ${userId}`);
						return;
					}
					if (this.speechOptions.focusUser && userId !== this.speechOptions.focusUser) {
						this.debug(`Ignoring non-focused user ${userId}`);
						return;
					}
				}
			}

			// Avoid duplicate subscribe calls for the same active speaker (prevents listener buildup)
			// if (this._activeSpeakers.has(userId)) {
			// 	this.debug(`Already subscribed to ${userId}, skipping duplicate`);
			// 	return;
			// }

			// Prepare a per-session options override via onVoiceChange (non-blocking)
			const channelId = String(connection?.joinConfig?.channelId ?? "");
			const guildId = String(this.player?.guildId ?? "");
			const pendingOverrides = Promise.resolve(
				this.speechOptions?.onVoiceChange?.({
					userId,
					channelId,
					guildId,
					player: this.player,
					manager: this.manager,
					client: this.client,
					current: this.speechOptions,
				}),
			).catch((err) => {
				this.debug(`onVoiceChange error: ${err?.message || err}`);
				return undefined;
			});

			// this._activeSpeakers.add(userId);
			const opusStream = connection.receiver.subscribe(userId, {
				end: {
					// EndBehaviorType.AfterSilence === 1
					behavior: 1,
					duration: 300,
				},
			});

			// Prefer native @discordjs/opus; prism-media will pick it if installed.
			// Add defensive error handling to swallow transient corrupted frames.
			const decoder = new prism.opus.Decoder({ rate: 48000, channels: 2, frameSize: 960 });
			decoder.on("error", (e: any) => {
				try {
					const msg = String(e?.message || e || "");
					const transient = /compressed data passed is corrupted|invalid packet/i.test(msg);
					if (!transient) this.debug(`Decoder error: ${msg}`);
					// Swallow; let stream continue
				} catch {}
			});
			opusStream.on("error", (e: any) => {
				try {
					const msg = String(e?.message || e || "");
					this.debug(`Opus stream error: ${msg}`);
				} catch {}
			});

			const chunks: Buffer[] = [];
			opusStream
				.pipe(decoder)
				.pipe(new PcmStream())
				.on("data", (d: Buffer) => chunks.push(d))
				.on("end", async () => {
					const overrides = (await pendingOverrides) || {};
					const effective = { ...this.speechOptions, ...overrides } as SpeechOptions;
					const delay = effective.postSilenceDelayMs ?? 2000;
					this.debug(`Stopped speaking. Waiting ${delay}ms before resolving speech`);
					setTimeout(() => this.processVoice(userId, chunks, effective), delay);
				});
		});
	}

	private async processVoice(userId: string, bufferData: Buffer[], effective?: SpeechOptions) {
		const opts = effective ?? this.speechOptions;
		const pcm = Buffer.concat(bufferData);
		const durationSec = pcm.length / 48000 / 4; // 48kHz, 2ch, 16-bit
		// this._activeSpeakers.delete(userId);
		if (durationSec < opts.minimalVoiceMessageDuration) {
			this.debug(`Voice too short (${durationSec.toFixed(2)}s)`);
			return;
		}

		if (!this.checkAudioQuality(pcm)) {
			this.debug("Audio quality below threshold");
			return;
		}

		try {
			const content = await this.resolveSpeech(pcm, opts);
			if (!content) {
				this.debug("No speech recognized or empty response");
				return;
			}

			const connection = (this.player as any)?.connection;
			const channelId = String(connection?.joinConfig?.channelId ?? "");
			const guildId = String(this.player?.guildId ?? "");

			const payload: any = {
				content,
				userId,
				channelId,
				guildId,
			};

			if (this.client) {
				try {
					payload.user = this.client.users?.cache?.get?.(userId) ?? undefined;
					payload.channel = this.client.channels?.cache?.get?.(channelId) ?? undefined;
				} catch {}
			}

			// Emit directly via manager when available; fallback to player event
			if (this.manager && typeof (this.manager as any).emit === "function") {
				this.manager.emit("voiceCreate", this.player, payload);
			} else {
				(this.player as any)?.emit?.("voiceCreate", payload);
			}
		} catch (err: any) {
			this.debug(`Error processing voice: ${err?.message || err}`);
		}
	}

	public async resolveSpeech(audioBuffer: Buffer, opts?: SpeechOptions): Promise<string> {
		const use = opts ?? this.speechOptions;
		const monoBuffer = this.convertStereoToMono(audioBuffer);

		if (typeof use.resolveSpeech === "function") {
			try {
				const res = await use.resolveSpeech(monoBuffer, use);
				if (typeof res === "string") return res;
			} catch (err: any) {
				this.debug(`Custom resolveSpeech error: ${err?.message || err}`);
			}
		}

		return this.resolveSpeechWithGoogleSpeechV2(audioBuffer, use);
	}

	private checkAudioQuality(pcmBuffer: Buffer): boolean {
		try {
			const int16 = new Int16Array(pcmBuffer.buffer, pcmBuffer.byteOffset, pcmBuffer.length / 2);
			if (int16.length === 0) return false;
			let sum = 0;
			for (let i = 0; i < int16.length; i++) sum += int16[i] * int16[i];
			const rms = Math.sqrt(sum / int16.length);
			this.debug(`Audio RMS: ${rms.toFixed(2)}`);
			return rms > 500;
		} catch {
			return false;
		}
	}

	private async resolveSpeechWithGoogleSpeechV2(audioBuffer: Buffer, opts?: SpeechOptions): Promise<string> {
		const use = opts ?? this.speechOptions;
		const key = this.resolveGoogleSpeechKey(use);
		const lang = use.lang || "vi-VN";
		const profanityFilter = use.profanityFilter ? "1" : "0";

		const monoBuffer = this.convertStereoToMono(audioBuffer);
		this.debug(`Sending ${monoBuffer.length} bytes to Google Speech (lang=${lang})`);

		try {
			//see https://cloud.google.com/speech-to-text/v2/docs/recognizers
			const response = await axios({
				url: `https://www.google.com/speech-api/v2/recognize?output=json&lang=${lang}&key=${key}&pFilter=${profanityFilter}`,
				headers: { "Content-Type": "audio/l16; rate=48000; channels=1" },
				method: "POST",
				data: monoBuffer,
				transformResponse: [
					(data: string) => {
						if (!data || String(data).trim() === "") {
							throw new Error("Empty response from API");
						}
						const lines = String(data)
							.split("\n")
							.map((l) => l.trim())
							.filter((l) => l.length > 0);
						const last = lines[lines.length - 1];
						return JSON.parse(last);
					},
				],
			});

			if (!response?.data?.result || response.data.result.length === 0) return "";
			return response.data.result[0]?.alternative?.[0]?.transcript || "";
		} catch (error: any) {
			this.debug(`Google Speech error: ${error?.message || error}`);
			return "";
		}
	}

	private resolveGoogleSpeechKey(use: SpeechOptions): string {
		const explicit = use.key || process.env.GSPEECH_V2_KEY;
		if (explicit && String(explicit).trim().length > 0) return String(explicit).trim();

		// Fallback: Use a shared browser key commonly used for dev/testing.
		// This is intended for convenience in non-production scenarios.
		const fallback = "AIzaSyBOti4mM-6x9WDnZIjIeyEU21OpBXqWBgw";
		this.debug(
			"No GSPEECH_V2_KEY provided — using a shared fallback key (dev/testing). Set your own key to control quota. See https://cloud.google.com/speech-to-text/v2/docs/recognizers",
		);
		return fallback;
	}

	private convertStereoToMono(stereoBuffer: Buffer): Buffer {
		const stereoData = new Int16Array(stereoBuffer.buffer, stereoBuffer.byteOffset, stereoBuffer.length / 2);
		const monoData = new Int16Array(Math.floor(stereoData.length / 2));
		for (let i = 0; i < monoData.length; i++) {
			monoData[i] = Math.round((stereoData[i * 2] + stereoData[i * 2 + 1]) / 2);
		}
		return Buffer.from(monoData.buffer);
	}
}
