import react from "@vitejs/plugin-react";
import { mergeConfig } from "vite";
import baseConfig from "./vite.base.config.ts";

export default mergeConfig(baseConfig, {
  build: {
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("/ol/")) return "openlayers";
          if (id.includes("react") || id.includes("scheduler")) return "react-vendor";
          return undefined;
        },
      },
    },
  },
  plugins: [react()],
  server: { host: "127.0.0.1", port: 1420, strictPort: true },
});
