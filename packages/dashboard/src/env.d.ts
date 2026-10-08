interface ImportMetaEnv {
	readonly DEV: boolean;
	readonly VITE_IDE_URL_TEMPLATE?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}

declare module "*.css";
