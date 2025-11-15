import { EventEmitter } from "events";
import { Player } from "./Player";
import { PlayerManagerOptions, PlayerOptions, Track, SourcePlugin } from "../types";

const GLOBAL_MANAGER_KEY: symbol = Symbol.for("ziplayer.PlayerManager.instance");
export const getGlobalManager = (): PlayerManager | null => {
	try {
		const instance = (globalThis as any)[GLOBAL_MANAGER_KEY];
		if (!instance) {
			console.debug("[PlayerManager] No global instance found");
			return null;
		}
		return instance as PlayerManager;
	} catch (error) {
		console.error("[PlayerManager] Error getting global instance:", error);
		return null;
	}
};
const setGlobalManager = (instance: PlayerManager): void => {
	try {
		(globalThis as any)[GLOBAL_MANAGER_KEY] = instance;
		console.debug("[PlayerManager] Global instance set successfully");
	} catch (error) {
		console.error("[PlayerManager] Error setting global instance:", error);
	}
};

export class PlayerManager extends EventEmitter {
	private static instance: PlayerManager | null = null;
	private players: Map<string, Player> = new Map();
	private plugins: SourcePlugin[];
	private extensions: any[];
	private B_debug: boolean = false;

	private debug(message?: any, ...optionalParams: any[]): void {
		if (this.listenerCount("debug") > 0) {
			this.emit("debug", message, ...optionalParams);
			if (!this.B_debug) {
				this.B_debug = true;
			}
		}
	}

	constructor(options: PlayerManagerOptions = {}) {
		super();
		this.plugins = [];
		const provided = options.plugins || [];
		for (const p of provided as any[]) {
			try {
				if (p && typeof p === "object") {
					this.plugins.push(p as SourcePlugin);
				} else if (typeof p === "function") {
					const instance = new (p as any)();
					this.plugins.push(instance as SourcePlugin);
				}
			} catch (e) {
				this.debug(`[PlayerManager] Failed to init plugin:`, e);
			}
		}
		this.extensions = options.extensions || [];

		setGlobalManager(this);
	}

	private resolveGuildId(guildOrId: string | { id: string }): string {
		if (typeof guildOrId === "string") return guildOrId;
		if (guildOrId && typeof guildOrId === "object" && "id" in guildOrId) return guildOrId.id;
		throw new Error("Invalid guild or guildId provided.");
	}

	create(guildOrId: string | { id: string }, options?: PlayerOptions): Player {
		const guildId = this.resolveGuildId(guildOrId);
		if (this.players.has(guildId)) {
			return this.players.get(guildId)!;
		}

		this.debug(`[PlayerManager] Creating player for guildId: ${guildId}`);
		const player = new Player(guildId, options, this);
		this.plugins.forEach((plugin) => player.addPlugin(plugin));

		let extsToActivate: any[] = [];
		const optExts = (options as any)?.extensions as any[] | string[] | undefined;
		if (Array.isArray(optExts)) {
			if (optExts.length === 0) {
				extsToActivate = [];
			} else if (typeof optExts[0] === "string") {
				const wanted = new Set(optExts as string[]);
				extsToActivate = this.extensions.filter((ext) => {
					const name = typeof ext === "function" ? ext.name : ext?.name;
					return !!name && wanted.has(name);
				});
			} else {
				extsToActivate = optExts;
			}
		}

		for (const ext of extsToActivate) {
			let instance = ext;
			if (typeof ext === "function") {
				try {
					instance = new ext(player);
				} catch (e) {
					this.debug(`[PlayerManager] Extension constructor error:`, e);
					continue;
				}
			}
			if (instance && typeof instance === "object") {
				if ("player" in instance && !instance.player) instance.player = player;
				if (typeof instance.active === "function") {
					try {
						instance.active({ manager: this, player });
						this.debug(`[PlayerManager] Extension ${instance?.name} active`);
					} catch (e) {
						this.debug(`[PlayerManager] Extension activation error:`, e);
					}
				}
			}
		}

		// Forward all player events
		player.on("willPlay", (track, tracks) => this.emit("willPlay", player, track, tracks));
		player.on("trackStart", (track) => this.emit("trackStart", player, track));
		player.on("trackEnd", (track) => this.emit("trackEnd", player, track));
		player.on("queueEnd", () => this.emit("queueEnd", player));
		player.on("playerError", (error, track) => this.emit("playerError", player, error, track));
		player.on("connectionError", (error) => this.emit("connectionError", player, error));
		player.on("volumeChange", (old, volume) => this.emit("volumeChange", player, old, volume));
		player.on("queueAdd", (track) => this.emit("queueAdd", player, track));
		player.on("queueAddList", (tracks) => this.emit("queueAddList", player, tracks));
		player.on("queueRemove", (track, index) => this.emit("queueRemove", player, track, index));
		player.on("playerPause", (track) => this.emit("playerPause", player, track));
		player.on("playerResume", (track) => this.emit("playerResume", player, track));
		player.on("playerStop", () => this.emit("playerStop", player));
		player.on("playerDestroy", () => {
			this.emit("playerDestroy", player);
			this.players.delete(guildId);
		});
		player.on("ttsStart", (payload) => this.emit("ttsStart", player, payload));
		player.on("ttsEnd", () => this.emit("ttsEnd", player));
		player.on("debug", (...args) => {
			if (this.listenerCount("debug") > 0) {
				this.emit("debug", ...args);
			}
		});

		this.players.set(guildId, player);
		return player;
	}

	get(guildOrId: string | { id: string }): Player | undefined {
		const guildId = this.resolveGuildId(guildOrId);
		return this.players.get(guildId);
	}

	delete(guildOrId: string | { id: string }): boolean {
		const guildId = this.resolveGuildId(guildOrId);
		const player = this.players.get(guildId);
		if (player) {
			this.debug(`[PlayerManager] Deleting player for guildId: ${guildId}`);
			player.destroy();
			return this.players.delete(guildId);
		}
		return false;
	}

	has(guildOrId: string | { id: string }): boolean {
		const guildId = this.resolveGuildId(guildOrId);
		return this.players.has(guildId);
	}

	get size(): number {
		return this.players.size;
	}

	get debugEnabled(): boolean {
		return this.B_debug;
	}

	destroy(): void {
		this.debug(`[PlayerManager] Destroying all players`);
		for (const player of this.players.values()) {
			player.destroy();
		}
		this.players.clear();
		this.removeAllListeners();
	}
}

export function getInstance(): PlayerManager | null {
	const globalInst = getGlobalManager();
	if (!globalInst) {
		console.debug("[PlayerManager] Global instance not found, make sure to initialize with new PlayerManager(options)");
		return null;
	}
	return globalInst;
}
