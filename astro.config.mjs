import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

// https://astro.build/config
export default defineConfig({
	site: "https://jrife.io",
	integrations: [sitemap()],
	markdown: {
		shikiConfig: {
			theme: "material-theme-darker",
			langs: [],
		},
	},
});
