import {
	AppStorage,
	CustomProvidersStore,
	IndexedDBStorageBackend,
	ProviderKeysStore,
	SessionsStore,
	SettingsStore,
	setAppStorage,
} from "@mariozechner/pi-web-ui";
import { STORAGE_DB_NAME, STORAGE_DB_VERSION } from "./config.js";

export interface AppServices {
	storage: AppStorage;
	settings: SettingsStore;
	providerKeys: ProviderKeysStore;
	sessions: SessionsStore;
	customProviders: CustomProvidersStore;
	backend: IndexedDBStorageBackend;
}

export function createAppServices(): AppServices {
	const settings = new SettingsStore();
	const providerKeys = new ProviderKeysStore();
	const sessions = new SessionsStore();
	const customProviders = new CustomProvidersStore();

	const backend = new IndexedDBStorageBackend({
		dbName: STORAGE_DB_NAME,
		version: STORAGE_DB_VERSION,
		stores: [
			settings.getConfig(),
			SessionsStore.getMetadataConfig(),
			providerKeys.getConfig(),
			customProviders.getConfig(),
			sessions.getConfig(),
		],
	});

	settings.setBackend(backend);
	providerKeys.setBackend(backend);
	sessions.setBackend(backend);
	customProviders.setBackend(backend);

	const storage = new AppStorage(settings, providerKeys, sessions, customProviders, backend);
	setAppStorage(storage);

	return {
		storage,
		settings,
		providerKeys,
		sessions,
		customProviders,
		backend,
	};
}
