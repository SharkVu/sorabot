import { SourcePlugin, Track, SearchResult, StreamInfo } from "../types";

export abstract class BasePlugin implements SourcePlugin {
	abstract name: string;
	abstract version: string;

	abstract canHandle(query: string): boolean;
	abstract search(query: string, requestedBy: string): Promise<SearchResult>;
	abstract getStream(track: Track): Promise<StreamInfo>;

	getFallback?(track: Track): Promise<StreamInfo> {
		throw new Error("getFallback not implemented");
	}

	getRelatedTracks?(trackURL: string, opts?: { limit?: number; offset?: number; history?: Track[] }): Promise<Track[]> {
		return Promise.resolve([]);
	}

	validate?(url: string): boolean {
		return this.canHandle(url);
	}

	extractPlaylist?(url: string, requestedBy: string): Promise<Track[]> {
		return Promise.resolve([]);
	}
}
