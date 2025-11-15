import { VoiceConnection } from "@discordjs/voice";
import { Readable } from "stream";
import { Player } from "../structures/Player";

export interface Track {
	id: string;
	title: string;
	url: string;
	duration: number;
	thumbnail?: string;
	requestedBy: string;
	source: string;
	metadata?: Record<string, any>;
}

export interface SearchResult {
	tracks: Track[];
	playlist?: {
		name: string;
		url: string;
		thumbnail?: string;
	};
}

export interface StreamInfo {
	stream: Readable;
	type: "webm/opus" | "ogg/opus" | "arbitrary";
	metadata?: Record<string, any>;
}

export interface PlayerOptions {
	leaveOnEnd?: boolean;
	leaveOnEmpty?: boolean;
	leaveTimeout?: number;
	volume?: number;
	quality?: "high" | "low";
	selfDeaf?: boolean;
	selfMute?: boolean;
	/**
	 * Timeout in milliseconds for plugin operations (search, streaming, etc.)
	 * to prevent long-running tasks from blocking the player.
	 */
	extractorTimeout?: number;
	userdata?: Record<string, any>;
	/**
	 * Text-to-Speech settings. When enabled, the player can create a
	 * dedicated AudioPlayer to play TTS while pausing the music player
	 * then resume the music after TTS finishes.
	 */
	tts?: {
		/** Create a dedicated tts AudioPlayer at construction time */
		createPlayer?: boolean;
		/** Pause music and swap subscription to play TTS */
		interrupt?: boolean;
		/** Default TTS volume multiplier 1 => 100% */
		volume?: number;
		/** Max time tts playback Duration */
		Max_Time_TTS?: number;
	};
	/**
	 * Optional per-player extension selection. When provided, only these
	 * extensions will be activated for the created player.
	 * - Provide instances or constructors to use them explicitly
	 * - Or provide names (string) to select from manager-registered extensions
	 */
	extensions?: any[] | string[];
}

export type SourcePluginCtor<T extends SourcePlugin = SourcePlugin> = new (...args: any[]) => T;
export type SourcePluginLike = SourcePlugin | SourcePluginCtor;

export interface PlayerManagerOptions {
	plugins?: SourcePluginLike[];
	extensions?: any[];
}

export interface ProgressBarOptions {
	size?: number;
	barChar?: string;
	progressChar?: string;
}

export type LoopMode = "off" | "track" | "queue";

export interface PlayerEvents {
	debug: [message: string, ...args: any[]];
	willPlay: [track: Track, upcomingTracks: Track[]];
	trackStart: [track: Track];
	trackEnd: [track: Track];
	queueEnd: [];
	playerError: [error: Error, track?: Track];
	connectionError: [error: Error];
	volumeChange: [oldVolume: number, newVolume: number];
	queueAdd: [track: Track];
	queueAddList: [tracks: Track[]];
	queueRemove: [track: Track, index: number];
	playerPause: [track: Track];
	playerResume: [track: Track];
	playerStop: [];
	playerDestroy: [];
	/** Emitted when TTS starts playing (interruption mode) */
	ttsStart: [payload: { text?: string; track?: Track }];
	/** Emitted when TTS finished (interruption mode) */
	ttsEnd: [];
}

// Plugin interfaces
export interface SourcePlugin {
	name: string;
	version: string;
	canHandle(query: string): boolean;
	search(query: string, requestedBy: string): Promise<SearchResult>;
	getStream(track: Track): Promise<StreamInfo>;
	getRelatedTracks?(track: string | number, opts?: { limit?: number; offset?: number }): Promise<Track[]>;
	validate?(url: string): boolean;
	extractPlaylist?(url: string, requestedBy: string): Promise<Track[]>;
}

// Extension interfaces
export interface SourceExtension {
	name: string;
	version: string;
	connection?: VoiceConnection;
	player: Player | null;
	active(alas: any): boolean;
}
