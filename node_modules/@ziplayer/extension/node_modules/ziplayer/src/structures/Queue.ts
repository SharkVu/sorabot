import { Track, LoopMode } from "../types";

export class Queue {
	private tracks: Track[] = [];
	private current: Track | null = null;
	private history: Track[] = [];
	private _autoPlay = false;
	private _loop: LoopMode = "off";
	private willnext: Track | null = null;

	add(track: Track): void {
		this.tracks.push(track);
	}

	addMultiple(tracks: Track[]): void {
		this.tracks.push(...tracks);
	}

	/** Insert a track at a specific upcoming position (0 = next) */
	insert(track: Track, index: number): void {
		if (!Number.isFinite(index)) {
			this.tracks.push(track);
			return;
		}
		const i = Math.max(0, Math.min(Math.floor(index), this.tracks.length));
		if (i === this.tracks.length) {
			this.tracks.push(track);
			return;
		}
		if (i <= 0) {
			this.tracks.unshift(track);
			return;
		}
		this.tracks.splice(i, 0, track);
	}

	/** Insert multiple tracks at a specific upcoming position, preserving order */
	insertMultiple(tracks: Track[], index: number): void {
		if (!Array.isArray(tracks) || tracks.length === 0) return;
		if (!Number.isFinite(index)) {
			this.tracks.push(...tracks);
			return;
		}
		const i = Math.max(0, Math.min(Math.floor(index), this.tracks.length));
		if (i === 0) {
			this.tracks = [...tracks, ...this.tracks];
			return;
		}
		if (i === this.tracks.length) {
			this.tracks.push(...tracks);
			return;
		}
		this.tracks.splice(i, 0, ...tracks);
	}

	remove(index: number): Track | null {
		if (index < 0 || index >= this.tracks.length) return null;
		return this.tracks.splice(index, 1)[0];
	}

	next(ignoreLoop = false): Track | null {
		if (this.current) {
			if (this._loop === "track" && !ignoreLoop) {
				return this.current;
			}
			this.history.push(this.current);
			if (this.history.length > 200) {
				this.history.shift();
			}
		}
		this.current = this.tracks.shift() || null;
		if (!this.current && this._loop === "queue" && this.history.length > 0 && !ignoreLoop) {
			this.tracks = [...this.history];
			this.history = [];
			this.current = this.tracks.shift() || null;
		}
		return this.current;
	}

	clear(): void {
		this.tracks = [];
	}

	autoPlay(value?: boolean): boolean {
		if (typeof value !== "undefined") {
			this._autoPlay = value;
		}
		return this._autoPlay;
	}

	loop(mode?: LoopMode): LoopMode {
		if (mode) {
			this._loop = mode;
		}
		return this._loop;
	}

	shuffle(): void {
		for (let i = this.tracks.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[this.tracks[i], this.tracks[j]] = [this.tracks[j], this.tracks[i]];
		}
	}

	get size(): number {
		return this.tracks.length;
	}

	get isEmpty(): boolean {
		return this.tracks.length === 0;
	}

	get currentTrack(): Track | null {
		return this.current;
	}

	get previousTracks(): Track[] {
		return [...this.history];
	}

	get nextTrack(): Track | null {
		return this.tracks[0] || null;
	}

	willNextTrack(track?: Track): Track | null {
		if (track) {
			this.willnext = track;
			return this.willnext;
		}
		return this.willnext;
	}

	getTracks(): Track[] {
		return [...this.tracks];
	}

	getTrack(index: number): Track | null {
		return this.tracks[index] || null;
	}
}
