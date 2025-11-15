import { Track, LoopMode } from "../types";

/**
 * Manages the track queue for a player.
 *
 * @example
 * // Basic queue operations
 * const queue = player.queue;
 *
 * // Add single track
 * queue.add(track);
 *
 * // Add multiple tracks
 * queue.add([track1, track2, track3]);
 *
 * // Queue controls
 * queue.shuffle(); // Randomize order
 * queue.clear(); // Remove all tracks
 * queue.autoPlay(true); // Enable auto-play
 *
 * // Get queue information
 * console.log(`Queue length: ${queue.length}`);
 * console.log(`Current track: ${queue.current?.title}`);
 * console.log(`Is empty: ${queue.isEmpty}`);
 * console.log(`Is playing: ${queue.isPlaying}`);
 *
 * // Loop modes
 * queue.setLoopMode("track"); // Loop current track
 * queue.setLoopMode("queue"); // Loop entire queue
 * queue.setLoopMode("off"); // No loop
 *
 * // Remove specific track
 * const removed = queue.remove(0); // Remove first track
 * if (removed) {
 *   console.log(`Removed: ${removed.title}`);
 * }
 */
export class Queue {
	private tracks: Track[] = [];
	private current: Track | null = null;
	private history: Track[] = [];
	private related: Track[] = [];
	private _autoPlay = false;
	private _loop: LoopMode = "off";
	private willnext: Track | null = null;

	/**
	 * Add track(s) to the queue
	 *
	 * @param {Track | Track[]} track - Track or array of tracks to add
	 * @example
	 * queue.add(track);
	 * queue.add([track1, track2, track3]);
	 */
	add(track: Track): void {
		this.tracks.push(track);
	}

	/**
	 * Add multiple tracks to the queue
	 *
	 * @param {Track[]} tracks - Tracks to add
	 * @example
	 * queue.addMultiple([track1, track2, track3]);
	 */
	addMultiple(tracks: Track[]): void {
		this.tracks.push(...tracks);
	}

	/**
	 * Insert a track at a specific upcoming position (0 = next)
	 *
	 * @param {Track} track - Track to insert
	 * @param {number} index - Index to insert the track at
	 * @example
	 * queue.insert(track, 0);
	 */
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

	/**
	 * Insert multiple tracks at a specific upcoming position, preserving order
	 *
	 * @param {Track[]} tracks - Tracks to insert
	 * @param {number} index - Index to insert the tracks at
	 * @example
	 * queue.insertMultiple([track1, track2, track3], 0);
	 */
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

	/**
	 * Remove a track from the queue
	 *
	 * @param {number} index - Index of track to remove
	 * @returns {Track | null} Removed track or null
	 * @example
	 * const removed = queue.remove(0);
	 * console.log(`Removed: ${removed?.title}`);
	 */

	remove(index: number): Track | null {
		if (index < 0 || index >= this.tracks.length) return null;
		return this.tracks.splice(index, 1)[0];
	}

	/**
	 * Get the next track in the queue
	 *
	 * @param {boolean} ignoreLoop - Ignore the loop mode
	 * @returns {Track | null} The next track or null
	 * @example
	 * const nextTrack = queue.next();
	 * console.log(`Next track: ${nextTrack?.title}`);
	 */
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

	/**
	 * Clear all tracks from the queue
	 *
	 * @example
	 * queue.clear();
	 */
	clear(): void {
		this.tracks = [];
	}

	/**
	 * Enable or disable auto-play
	 *
	 * @param {boolean} value - Enable/disable auto-play
	 * @returns {boolean} Current auto-play state
	 * @example
	 * queue.autoPlay(true);
	 * queue.autoPlay(); // Get current auto-play state
	 */

	autoPlay(value?: boolean): boolean {
		if (typeof value !== "undefined") {
			this._autoPlay = value;
		}
		return this._autoPlay;
	}

	/**
	 * Set the loop mode
	 *
	 * @param {LoopMode} mode - Loop mode to set
	 * @returns {LoopMode} The loop mode
	 * @example
	 * queue.loop("track");
	 */
	loop(mode?: LoopMode): LoopMode {
		if (mode) {
			this._loop = mode;
		}
		return this._loop;
	}

	/**
	 * Shuffle the queue
	 *
	 * @example
	 * queue.shuffle();
	 */

	shuffle(): void {
		for (let i = this.tracks.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[this.tracks[i], this.tracks[j]] = [this.tracks[j], this.tracks[i]];
		}
	}

	/**
	 * Get the size of the queue
	 *
	 * @returns {number} The size of the queue
	 * @example
	 * const size = queue.size;
	 * console.log(`Queue size: ${size}`);
	 */
	get size(): number {
		return this.tracks.length;
	}

	/**
	 * Check if the queue is empty
	 *
	 * @returns {boolean} True if the queue is empty
	 * @example
	 * const empty = queue.isEmpty;
	 * console.log(`Queue is empty: ${empty}`);
	 */
	get isEmpty(): boolean {
		return this.tracks.length === 0;
	}

	/**
	 * Get the current track
	 *
	 * @returns {Track | null} The current track or null
	 * @example
	 * const currentTrack = queue.currentTrack;
	 * console.log(`Current track: ${currentTrack?.title}`);
	 */
	get currentTrack(): Track | null {
		return this.current;
	}

	/**
	 * Get the previous tracks
	 *
	 * @returns {Track[]} The previous tracks
	 * @example
	 * const previousTracks = queue.previousTracks;
	 * console.log(`Previous tracks: ${previousTracks.length}`);
	 */
	get previousTracks(): Track[] {
		return [...this.history];
	}

	/**
	 * Get the next track
	 *
	 * @returns {Track | null} The next track or null
	 * @example
	 * const nextTrack = queue.nextTrack;
	 * console.log(`Next track: ${nextTrack?.title}`);
	 */
	get nextTrack(): Track | null {
		return this.tracks[0] || null;
	}

	/**
	 * Move back to the previously played track.
	 * Makes the current track the next upcoming track, then sets previous as current.
	 *
	 * @returns {Track | null} The previous track or null
	 * @example
	 * const previousTrack = queue.previous();
	 * console.log(`Previous track: ${previousTrack?.title}`);
	 */
	previous(): Track | null {
		if (this.history.length === 0) return null;
		if (this.current) {
			this.tracks.unshift(this.current);
		}
		this.current = this.history.pop() || null;
		return this.current;
	}

	/**
	 * Get the next track
	 *
	 * @param {Track} track - The next track
	 * @returns {Track | null} The next track or null
	 * @example
	 * const nextTrack = queue.willNextTrack();
	 * console.log(`Next track: ${nextTrack?.title}`);
	 */
	willNextTrack(track?: Track): Track | null {
		if (track) {
			this.willnext = track;
		}
		return this.willnext;
	}

	/**
	 * Get the related tracks
	 *
	 * @param {Track[]} track - The related tracks
	 * @returns {Track[] | null} The related tracks or null
	 * @example
	 * const relatedTracks = queue.relatedTracks();
	 * console.log(`Related tracks: ${relatedTracks?.length}`);
	 */
	relatedTracks(track?: Track[]): Track[] | null {
		if (track) {
			this.related = track;
		}
		return this.related;
	}

	/**
	 * Get the tracks
	 *
	 * @returns {Track[]} The tracks
	 * @example
	 * const tracks = queue.getTracks();
	 * console.log(`Tracks: ${tracks.length}`);
	 */
	getTracks(): Track[] {
		return [...this.tracks];
	}

	/**
	 * Get a track at a specific index
	 *
	 * @param {number} index - The index of the track
	 * @returns {Track | null} The track or null
	 * @example
	 * const track = queue.getTrack(0);
	 * console.log(`Track: ${track?.title}`);
	 */
	getTrack(index: number): Track | null {
		return this.tracks[index] || null;
	}
}
