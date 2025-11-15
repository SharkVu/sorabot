import { EventEmitter } from "events";
import {
	createAudioPlayer,
	createAudioResource,
	entersState,
	AudioPlayerStatus,
	VoiceConnection,
	AudioPlayer as DiscordAudioPlayer,
	VoiceConnectionStatus,
	NoSubscriberBehavior,
	joinVoiceChannel,
	AudioResource,
	StreamType,
} from "@discordjs/voice";

import { VoiceChannel } from "discord.js";
import { Readable } from "stream";
import { Track, PlayerOptions, PlayerEvents, SourcePlugin, SearchResult, ProgressBarOptions, LoopMode } from "../types";
import { Queue } from "./Queue";
import { PluginManager } from "../plugins";
import type { PlayerManager } from "./PlayerManager";
export declare interface Player {
	on<K extends keyof PlayerEvents>(event: K, listener: (...args: PlayerEvents[K]) => void): this;
	emit<K extends keyof PlayerEvents>(event: K, ...args: PlayerEvents[K]): boolean;
}

export class Player extends EventEmitter {
	public readonly guildId: string;
	public connection: VoiceConnection | null = null;
	public audioPlayer: DiscordAudioPlayer;
	public queue: Queue;
	public volume: number = 100;
	public isPlaying: boolean = false;
	public isPaused: boolean = false;
	public options: PlayerOptions;
	public pluginManager: PluginManager;
	public userdata?: Record<string, any>;
	private manager: PlayerManager;
	private leaveTimeout: NodeJS.Timeout | null = null;
	private currentResource: AudioResource | null = null;
	private volumeInterval: NodeJS.Timeout | null = null;
	private skipLoop = false;

	// TTS support
	private ttsPlayer: DiscordAudioPlayer | null = null;
	private ttsQueue: Array<Track> = [];
	private ttsActive = false;

	private withTimeout<T>(promise: Promise<T>, message: string): Promise<T> {
		const timeout = this.options.extractorTimeout ?? 15000;
		return Promise.race([promise, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(message)), timeout))]);
	}

	private debug(message?: any, ...optionalParams: any[]): void {
		if (this.listenerCount("debug") > 0) {
			this.emit("debug", message, ...optionalParams);
		}
	}

	constructor(guildId: string, options: PlayerOptions = {}, manager: PlayerManager) {
		super();
		this.debug(`[Player] Constructor called for guildId: ${guildId}`);
		this.guildId = guildId;
		this.queue = new Queue();
		this.manager = manager;
		this.audioPlayer = createAudioPlayer({
			behaviors: {
				noSubscriber: NoSubscriberBehavior.Pause,
				maxMissedFrames: 100,
			},
		});

		this.pluginManager = new PluginManager();

		this.options = {
			leaveOnEnd: true,
			leaveOnEmpty: true,
			leaveTimeout: 100000,
			volume: 100,
			quality: "high",
			extractorTimeout: 50000,
			selfDeaf: true,
			selfMute: false,
			...options,
			tts: {
				createPlayer: false,
				interrupt: true,
				volume: 100,
				Max_Time_TTS: 60_000,
				...(options?.tts || {}),
			},
		};

		this.volume = this.options.volume || 100;
		this.userdata = this.options.userdata;
		this.setupEventListeners();

		// Optionally pre-create the TTS AudioPlayer
		if (this.options?.tts?.createPlayer) {
			this.ensureTTSPlayer();
		}
	}

	private setupEventListeners(): void {
		this.audioPlayer.on("stateChange", (oldState, newState) => {
			this.debug(`[Player] AudioPlayer stateChange from ${oldState.status} to ${newState.status}`);
			if (newState.status === AudioPlayerStatus.Idle && oldState.status !== AudioPlayerStatus.Idle) {
				// Track ended
				const track = this.queue.currentTrack;
				if (track) {
					this.debug(`[Player] Track ended: ${track.title}`);
					this.emit("trackEnd", track);
				}
				this.playNext();
			} else if (
				newState.status === AudioPlayerStatus.Playing &&
				(oldState.status === AudioPlayerStatus.Idle || oldState.status === AudioPlayerStatus.Buffering)
			) {
				// Track started
				this.isPlaying = true;
				this.isPaused = false;
				const track = this.queue.currentTrack;
				if (track) {
					this.debug(`[Player] Track started: ${track.title}`);
					this.emit("trackStart", track);
				}
			} else if (newState.status === AudioPlayerStatus.Paused && oldState.status !== AudioPlayerStatus.Paused) {
				// Track paused
				this.isPaused = true;
				const track = this.queue.currentTrack;
				if (track) {
					this.debug(`[Player] Player paused on track: ${track.title}`);
					this.emit("playerPause", track);
				}
			} else if (newState.status !== AudioPlayerStatus.Paused && oldState.status === AudioPlayerStatus.Paused) {
				// Track resumed
				this.isPaused = false;
				const track = this.queue.currentTrack;
				if (track) {
					this.debug(`[Player] Player resumed on track: ${track.title}`);
					this.emit("playerResume", track);
				}
			} else if (newState.status === AudioPlayerStatus.AutoPaused) {
				this.debug(`[Player] AudioPlayerStatus.AutoPaused`);
			} else if (newState.status === AudioPlayerStatus.Buffering) {
				this.debug(`[Player] AudioPlayerStatus.Buffering`);
			}
		});
		this.audioPlayer.on("error", (error) => {
			this.debug(`[Player] AudioPlayer error:`, error);
			this.emit("playerError", error, this.queue.currentTrack || undefined);
			this.playNext();
		});

		this.audioPlayer.on("debug", (...args) => {
			if (this.manager.debugEnabled) {
				this.emit("debug", ...args);
			}
		});
	}

	private ensureTTSPlayer(): DiscordAudioPlayer {
		if (this.ttsPlayer) return this.ttsPlayer;
		this.ttsPlayer = createAudioPlayer({
			behaviors: {
				noSubscriber: NoSubscriberBehavior.Pause,
				maxMissedFrames: 100,
			},
		});
		this.ttsPlayer.on("error", (e) => this.debug("[TTS] error:", e));
		return this.ttsPlayer;
	}

	addPlugin(plugin: SourcePlugin): void {
		this.debug(`[Player] Adding plugin: ${plugin.name}`);
		this.pluginManager.register(plugin);
	}

	removePlugin(name: string): boolean {
		this.debug(`[Player] Removing plugin: ${name}`);
		return this.pluginManager.unregister(name);
	}

	async connect(channel: VoiceChannel): Promise<VoiceConnection> {
		try {
			this.debug(`[Player] Connecting to voice channel: ${channel.id}`);
			const connection = joinVoiceChannel({
				channelId: channel.id,
				guildId: channel.guildId,
				adapterCreator: channel.guild.voiceAdapterCreator as any,
				selfDeaf: this.options.selfDeaf ?? true,
				selfMute: this.options.selfMute ?? false,
			});

			await entersState(connection, VoiceConnectionStatus.Ready, 50_000);
			this.connection = connection;

			connection.on(VoiceConnectionStatus.Disconnected, () => {
				this.debug(`[Player] VoiceConnectionStatus.Disconnected`);
				this.destroy();
			});

			connection.on("error", (error) => {
				this.debug(`[Player] Voice connection error:`, error);
				this.emit("connectionError", error);
			});
			connection.subscribe(this.audioPlayer);

			if (this.leaveTimeout) {
				clearTimeout(this.leaveTimeout);
				this.leaveTimeout = null;
			}
			return this.connection;
		} catch (error) {
			this.debug(`[Player] Connection error:`, error);
			this.emit("connectionError", error as Error);
			this.connection?.destroy();
			throw error;
		}
	}

	async search(query: string, requestedBy: string): Promise<SearchResult> {
		this.debug(`[Player] Search called with query: ${query}, requestedBy: ${requestedBy}`);
		const plugins = this.pluginManager.getAll();
		let lastError: any = null;

		for (const p of plugins) {
			try {
				this.debug(`[Player] Trying plugin for search: ${p.name}`);
				const res = await this.withTimeout(p.search(query, requestedBy), `Search operation timed out for ${p.name}`);
				if (res && Array.isArray(res.tracks) && res.tracks.length > 0) {
					this.debug(`[Player] Plugin '${p.name}' returned ${res.tracks.length} tracks`);
					return res;
				}
				this.debug(`[Player] Plugin '${p.name}' returned no tracks`);
			} catch (error) {
				lastError = error;
				this.debug(`[Player] Search via plugin '${p.name}' failed:`, error);
				// Continue to next plugin
			}
		}

		this.debug(`[Player] No plugins returned results for query: ${query}`);
		if (lastError) this.emit("playerError", lastError as Error);
		throw new Error(`No plugin found to handle: ${query}`);
	}

	async play(query: string | Track, requestedBy?: string): Promise<boolean> {
		try {
			this.debug(`[Player] Play called with query: ${typeof query === "string" ? query : query?.title}`);
			let tracksToAdd: Track[] = [];
			let isPlaylist = false;
			if (typeof query === "string") {
				const searchResult = await this.search(query, requestedBy || "Unknown");
				tracksToAdd = searchResult.tracks;

				if (searchResult.playlist) {
					isPlaylist = true;
					this.debug(`[Player] Added playlist: ${searchResult.playlist.name} (${tracksToAdd.length} tracks)`);
				}
			} else {
				tracksToAdd = [query];
			}

			if (tracksToAdd.length === 0) {
				this.debug(`[Player] No tracks found for play`);
				throw new Error("No tracks found");
			}

			// If a TTS track is requested and interrupt mode is enabled, handle it separately
			const isTTS = (t: Track | undefined) => {
				if (!t) return false;
				try {
					return typeof t.source === "string" && t.source.toLowerCase().includes("tts");
				} catch {
					return false;
				}
			};

			const queryLooksTTS = typeof query === "string" && query.trim().toLowerCase().startsWith("tts");

			if (
				!isPlaylist &&
				tracksToAdd.length > 0 &&
				this.options?.tts?.interrupt !== false &&
				(isTTS(tracksToAdd[0]) || queryLooksTTS)
			) {
				// Interrupt music playback with TTS (do not modify the music queue)
				this.debug(`[Player] Interrupting with TTS: ${tracksToAdd[0].title}`);
				await this.interruptWithTTSTrack(tracksToAdd[0]);
				return true;
			}

			if (isPlaylist) {
				this.queue.addMultiple(tracksToAdd);
				this.emit("queueAddList", tracksToAdd);
			} else {
				this.queue.add(tracksToAdd?.[0]);
				this.emit("queueAdd", tracksToAdd?.[0]);
			}

			// Start playing if not already playing
			if (!this.isPlaying) {
				return this.playNext();
			}

			return true;
		} catch (error) {
			this.debug(`[Player] Play error:`, error);
			this.emit("playerError", error as Error);
			return false;
		}
	}

	/**
	 * Interrupt current music with a TTS track. Pauses music, swaps the
	 * subscription to a dedicated TTS player, plays TTS, then resumes.
	 */
	public async interruptWithTTSTrack(track: Track): Promise<void> {
		this.ttsQueue.push(track);
		if (!this.ttsActive) {
			void this.playNextTTS();
		}
	}

	/** Play queued TTS items sequentially */
	private async playNextTTS(): Promise<void> {
		const next = this.ttsQueue.shift();
		if (!next) return;
		this.ttsActive = true;

		try {
			if (!this.connection) throw new Error("No voice connection for TTS");
			const ttsPlayer = this.ensureTTSPlayer();

			// Build resource from plugin stream
			const resource = await this.resourceFromTrack(next);
			if (resource.volume) {
				resource.volume.setVolume((this.options?.tts?.volume ?? this?.volume ?? 100) / 100);
			}

			const wasPlaying =
				this.audioPlayer.state.status === AudioPlayerStatus.Playing ||
				this.audioPlayer.state.status === AudioPlayerStatus.Buffering;

			// Pause current music if any
			try {
				this.audioPlayer.pause(true);
			} catch {}

			// Swap subscription and play TTS
			this.connection.subscribe(ttsPlayer);
			this.emit("ttsStart", { track: next });
			ttsPlayer.play(resource);

			// Wait until TTS starts then finishes
			await entersState(ttsPlayer, AudioPlayerStatus.Playing, 5_000).catch(() => null);
			await entersState(ttsPlayer, AudioPlayerStatus.Idle, this.options?.tts?.Max_Time_TTS || 60_000).catch(() => null);

			// Swap back and resume if needed
			this.connection.subscribe(this.audioPlayer);
			if (wasPlaying) {
				try {
					this.audioPlayer.unpause();
				} catch {}
			}
			this.emit("ttsEnd");
		} catch (err) {
			this.debug("[TTS] error while playing:", err);
			this.emit("playerError", err as Error);
		} finally {
			this.ttsActive = false;
			if (this.ttsQueue.length > 0) {
				await this.playNextTTS();
			}
		}
	}

	/** Build AudioResource for a given track using the plugin pipeline */
	private async resourceFromTrack(track: Track): Promise<AudioResource> {
		// Resolve plugin similar to playNext
		const plugin = this.pluginManager.findPlugin(track.url) || this.pluginManager.get(track.source);
		if (!plugin) throw new Error(`No plugin found for track: ${track.title}`);

		let streamInfo: any;
		try {
			streamInfo = await this.withTimeout(plugin.getStream(track), "getStream timed out");
		} catch (streamError) {
			// try fallbacks
			const allplugs = this.pluginManager.getAll();
			for (const p of allplugs) {
				if (typeof (p as any).getFallback !== "function") continue;
				try {
					streamInfo = await this.withTimeout(
						(p as any).getFallback(track),
						`getFallback timed out for plugin ${(p as any).name}`,
					);
					if (!streamInfo?.stream) continue;
					break;
				} catch {}
			}
			if (!streamInfo?.stream) throw new Error(`All getFallback attempts failed for track: ${track.title}`);
		}

		const mapToStreamType = (type: string): StreamType => {
			switch (type) {
				case "webm/opus":
					return StreamType.WebmOpus;
				case "ogg/opus":
					return StreamType.OggOpus;
				case "arbitrary":
				default:
					return StreamType.Arbitrary;
			}
		};

		const inputType = mapToStreamType(streamInfo.type);
		return createAudioResource(streamInfo.stream, {
			metadata: track,
			inputType,
			inlineVolume: true,
		});
	}

	private async generateWillNext(): Promise<void> {
		const lastTrack = this.queue.previousTracks[this.queue.previousTracks.length - 1] ?? this.queue.currentTrack;
		if (!lastTrack) return;

		// Build list of candidate plugins: preferred first, then others with getRelatedTracks
		const preferred = this.pluginManager.findPlugin(lastTrack.url) || this.pluginManager.get(lastTrack.source);
		const all = this.pluginManager.getAll();
		const candidates = [...(preferred ? [preferred] : []), ...all.filter((p) => p !== preferred)].filter(
			(p) => typeof (p as any).getRelatedTracks === "function",
		);

		for (const p of candidates) {
			try {
				this.debug(`[Player] Trying related from plugin: ${p.name}`);
				const related = await this.withTimeout(
					(p as any).getRelatedTracks(lastTrack.url, {
						limit: 10,
						history: this.queue.previousTracks,
					}),
					`getRelatedTracks timed out for ${p.name}`,
				);

				if (Array.isArray(related) && related.length > 0) {
					const randomchoice = Math.floor(Math.random() * related.length);
					const nextTrack = this.queue.nextTrack ? this.queue.nextTrack : related[randomchoice];
					this.queue.willNextTrack(nextTrack);
					this.debug(`[Player] Will next track if autoplay: ${nextTrack?.title} (via ${p.name})`);
					this.emit("willPlay", nextTrack, related);
					return; // success
				}
				this.debug(`[Player] ${p.name} returned no related tracks`);
			} catch (err) {
				this.debug(`[Player] getRelatedTracks error from ${p.name}:`, err);
				// try next candidate
			}
		}
	}

	private async playNext(): Promise<boolean> {
		this.debug(`[Player] playNext called`);
		const track = this.queue.next(this.skipLoop);
		this.skipLoop = false;
		if (!track) {
			if (this.queue.autoPlay()) {
				const willnext = this.queue.willNextTrack();
				console.log("willnext", willnext);
				if (willnext) {
					this.debug(`[Player] Auto-playing next track: ${willnext.title}`);
					this.queue.addMultiple([willnext]);
					return this.playNext();
				}
			}

			this.debug(`[Player] No next track in queue`);
			this.isPlaying = false;
			this.emit("queueEnd");

			if (this.options.leaveOnEnd) {
				this.scheduleLeave();
			}
			return false;
		}

		this.generateWillNext();

		try {
			// Find plugin that can handle this track
			const plugin = this.pluginManager.findPlugin(track.url) || this.pluginManager.get(track.source);

			if (!plugin) {
				this.debug(`[Player] No plugin found for track: ${track.title}`);
				throw new Error(`No plugin found for track: ${track.title}`);
			}

			this.debug(`[Player] Getting stream for track: ${track.title}`);
			this.debug(`[Player] Using plugin: ${plugin.name}`);
			this.debug(`[Track] Track Info:`, track);
			let streamInfo;
			try {
				streamInfo = await this.withTimeout(plugin.getStream(track), "getStream timed out");
			} catch (streamError) {
				this.debug(`[Player] getStream failed, trying getFallback:`, streamError);
				const allplugs = this.pluginManager.getAll();
				for (const p of allplugs) {
					if (typeof p.getFallback !== "function") {
						continue;
					}
					try {
						streamInfo = await this.withTimeout(p.getFallback(track), `getFallback timed out for plugin ${p.name}`);
						if (!streamInfo.stream) continue;
						this.debug(`[Player] getFallback succeeded with plugin ${p.name} for track: ${track.title}`);
						break;
					} catch (fallbackError) {
						this.debug(`[Player] getFallback failed with plugin ${p.name}:`, fallbackError);
					}
				}
				if (!streamInfo?.stream) {
					throw new Error(`All getFallback attempts failed for track: ${track.title}`);
				}
				this.debug(streamInfo);
			}

			function mapToStreamType(type: string): StreamType {
				switch (type) {
					case "webm/opus":
						return StreamType.WebmOpus;
					case "ogg/opus":
						return StreamType.OggOpus;
					case "arbitrary":
						return StreamType.Arbitrary;
					default:
						return StreamType.Arbitrary;
				}
			}

			let stream: Readable = streamInfo.stream;
			let inputType = mapToStreamType(streamInfo.type);

			this.currentResource = createAudioResource(stream, {
				metadata: track,
				inputType,
				inlineVolume: true,
			});

			// Apply initial volume using the resource's VolumeTransformer
			if (this.volumeInterval) {
				clearInterval(this.volumeInterval);
				this.volumeInterval = null;
			}
			this.currentResource.volume?.setVolume(this.volume / 100);

			this.debug(`[Player] Playing resource for track: ${track.title}`);
			this.audioPlayer.play(this.currentResource);

			await entersState(this.audioPlayer, AudioPlayerStatus.Playing, 5_000);

			return true;
		} catch (error) {
			this.debug(`[Player] playNext error:`, error);
			this.emit("playerError", error as Error, track);
			return this.playNext();
		}
	}

	pause(): boolean {
		this.debug(`[Player] pause called`);
		if (this.isPlaying && !this.isPaused) {
			return this.audioPlayer.pause();
		}
		return false;
	}

	resume(): boolean {
		this.debug(`[Player] resume called`);
		if (this.isPaused) {
			const result = this.audioPlayer.unpause();
			if (result) {
				const track = this.queue.currentTrack;
				if (track) {
					this.debug(`[Player] Player resumed on track: ${track.title}`);
					this.emit("playerResume", track);
				}
			}
			return result;
		}
		return false;
	}

	stop(): boolean {
		this.debug(`[Player] stop called`);
		this.queue.clear();
		const result = this.audioPlayer.stop();
		this.isPlaying = false;
		this.isPaused = false;
		this.emit("playerStop");
		return result;
	}

	skip(): boolean {
		this.debug(`[Player] skip called`);
		if (this.isPlaying || this.isPaused) {
			this.skipLoop = true;
			return this.audioPlayer.stop();
		}
		return !!this.playNext();
	}

	loop(mode?: LoopMode): LoopMode {
		return this.queue.loop(mode);
	}

	autoPlay(mode?: boolean): boolean {
		return this.queue.autoPlay(mode);
	}

	setVolume(volume: number): boolean {
		this.debug(`[Player] setVolume called: ${volume}`);
		if (volume < 0 || volume > 200) return false;

		const oldVolume = this.volume;
		this.volume = volume;
		const resourceVolume = this.currentResource?.volume;

		if (resourceVolume) {
			if (this.volumeInterval) clearInterval(this.volumeInterval);

			const start = resourceVolume.volume;
			const target = this.volume / 100;
			const steps = 10;
			let currentStep = 0;

			this.volumeInterval = setInterval(() => {
				currentStep++;
				const value = start + ((target - start) * currentStep) / steps;
				resourceVolume.setVolume(value);
				if (currentStep >= steps) {
					clearInterval(this.volumeInterval!);
					this.volumeInterval = null;
				}
			}, 300);
		}

		this.emit("volumeChange", oldVolume, volume);
		return true;
	}

	shuffle(): void {
		this.debug(`[Player] shuffle called`);
		this.queue.shuffle();
	}

	clearQueue(): void {
		this.debug(`[Player] clearQueue called`);
		this.queue.clear();
	}

	/**
	 * Insert a track or list of tracks into the upcoming queue at a specific position (0 = play after current).
	 * - If `query` is a string, performs a search and inserts resulting tracks (playlist supported).
	 * - If a Track or Track[] is provided, inserts directly.
	 * Does not auto-start playback; it only modifies the queue.
	 */
	async insert(query: string | Track | Track[], index: number, requestedBy?: string): Promise<boolean> {
		try {
			this.debug(`[Player] insert called at index ${index} with type: ${typeof query}`);
			let tracksToAdd: Track[] = [];
			let isPlaylist = false;

			if (typeof query === "string") {
				const searchResult = await this.search(query, requestedBy || "Unknown");
				tracksToAdd = searchResult.tracks || [];
				isPlaylist = !!searchResult.playlist;
			} else if (Array.isArray(query)) {
				tracksToAdd = query;
				isPlaylist = query.length > 1;
			} else if (query) {
				tracksToAdd = [query];
			}

			if (!tracksToAdd || tracksToAdd.length === 0) {
				this.debug(`[Player] insert: no tracks resolved`);
				throw new Error("No tracks to insert");
			}

			if (tracksToAdd.length === 1) {
				this.queue.insert(tracksToAdd[0], index);
				this.emit("queueAdd", tracksToAdd[0]);
				this.debug(`[Player] Inserted track at index ${index}: ${tracksToAdd[0].title}`);
			} else {
				this.queue.insertMultiple(tracksToAdd, index);
				this.emit("queueAddList", tracksToAdd);
				this.debug(`[Player] Inserted ${tracksToAdd.length} ${isPlaylist ? "playlist " : ""}tracks at index ${index}`);
			}

			return true;
		} catch (error) {
			this.debug(`[Player] insert error:`, error);
			this.emit("playerError", error as Error);
			return false;
		}
	}

	remove(index: number): Track | null {
		this.debug(`[Player] remove called for index: ${index}`);
		const track = this.queue.remove(index);
		if (track) {
			this.emit("queueRemove", track, index);
		}
		return track;
	}

	getProgressBar(options: ProgressBarOptions = {}): string {
		const { size = 20, barChar = "▬", progressChar = "🔘" } = options;
		const track = this.queue.currentTrack;
		const resource = this.currentResource;
		if (!track || !resource) return "";

		const total = track.duration > 1000 ? track.duration : track.duration * 1000;
		if (!total) return this.formatTime(resource.playbackDuration);

		const current = resource.playbackDuration;
		const ratio = Math.min(current / total, 1);
		const progress = Math.round(ratio * size);
		const bar = barChar.repeat(progress) + progressChar + barChar.repeat(size - progress);

		return `${this.formatTime(current)} ${bar} ${this.formatTime(total)}`;
	}

	private formatTime(ms: number): string {
		const totalSeconds = Math.floor(ms / 1000);
		const hours = Math.floor(totalSeconds / 3600);
		const minutes = Math.floor((totalSeconds % 3600) / 60);
		const seconds = totalSeconds % 60;
		const parts: string[] = [];
		if (hours > 0) parts.push(String(hours).padStart(2, "0"));
		parts.push(String(minutes).padStart(2, "0"));
		parts.push(String(seconds).padStart(2, "0"));
		return parts.join(":");
	}

	private scheduleLeave(): void {
		this.debug(`[Player] scheduleLeave called`);
		if (this.leaveTimeout) {
			clearTimeout(this.leaveTimeout);
		}

		if (this.options.leaveOnEmpty && this.options.leaveTimeout) {
			this.leaveTimeout = setTimeout(() => {
				this.debug(`[Player] Leaving voice channel after timeout`);
				this.destroy();
			}, this.options.leaveTimeout);
		}
	}

	destroy(): void {
		this.debug(`[Player] destroy called`);
		if (this.leaveTimeout) {
			clearTimeout(this.leaveTimeout);
			this.leaveTimeout = null;
		}

		this.audioPlayer.stop(true);

		if (this.ttsPlayer) {
			try {
				this.ttsPlayer.stop(true);
			} catch {}
			this.ttsPlayer = null;
		}

		if (this.connection) {
			this.connection.destroy();
			this.connection = null;
		}

		this.queue.clear();
		this.pluginManager.clear();
		this.isPlaying = false;
		this.isPaused = false;
		this.emit("playerDestroy");
		this.removeAllListeners();
	}

	// Getters
	get queueSize(): number {
		return this.queue.size;
	}

	get currentTrack(): Track | null {
		return this.queue.currentTrack;
	}

	get upcomingTracks(): Track[] {
		return this.queue.getTracks();
	}

	get previousTracks(): Track[] {
		return this.queue.previousTracks;
	}

	get availablePlugins(): string[] {
		return this.pluginManager.getAll().map((p) => p.name);
	}
}
