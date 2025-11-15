import { SourceExtension, Track, SearchResult, StreamInfo } from "../types";
import { Player } from "../structures/Player";

export abstract class BaseExtension implements SourceExtension {
	abstract name: string;
	abstract version: string;
	abstract player: Player | null;

	abstract active(alas: any): boolean;
}
