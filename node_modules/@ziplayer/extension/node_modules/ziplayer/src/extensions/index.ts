import { BaseExtension } from "./BaseExtension";

export { BaseExtension } from "./BaseExtension";

// Extension factory
export class ExtensionManager {
	private extensions: Map<string, BaseExtension> = new Map();

	register(extension: BaseExtension): void {
		this.extensions.set(extension.name, extension);
	}

	unregister(name: string): boolean {
		return this.extensions.delete(name);
	}

	get(name: string): BaseExtension | undefined {
		return this.extensions.get(name);
	}

	getAll(): BaseExtension[] {
		return Array.from(this.extensions.values());
	}

	findExtension(alas: any): BaseExtension | undefined {
		return this.getAll().find((extension) => extension.active(alas));
	}

	clear(): void {
		this.extensions.clear();
	}
}
