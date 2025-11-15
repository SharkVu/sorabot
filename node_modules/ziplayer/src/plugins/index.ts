import { BasePlugin } from "./BasePlugin";

export { BasePlugin } from "./BasePlugin";

// Plugin factory
export class PluginManager {
	private plugins: Map<string, BasePlugin> = new Map();

	register(plugin: BasePlugin): void {
		this.plugins.set(plugin.name, plugin);
	}

	unregister(name: string): boolean {
		return this.plugins.delete(name);
	}

	get(name: string): BasePlugin | undefined {
		return this.plugins.get(name);
	}

	getAll(): BasePlugin[] {
		return Array.from(this.plugins.values());
	}

	findPlugin(query: string): BasePlugin | undefined {
		return this.getAll().find((plugin) => plugin.canHandle(query));
	}

	clear(): void {
		this.plugins.clear();
	}
}
