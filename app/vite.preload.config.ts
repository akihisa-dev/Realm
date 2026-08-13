import { mergeConfig } from "vite";
import baseConfig from "./vite.base.config.ts";

export default mergeConfig(baseConfig, {
  build: { rollupOptions: { external: ["electron"] } },
});
