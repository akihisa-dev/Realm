import { MakerDMG } from "@electron-forge/maker-dmg";
import { VitePlugin } from "@electron-forge/plugin-vite";

import { ignoreRealmPackagePath, realmPackageExtraResources } from "./scripts/package-contents";
import { sanitizeMacInfoPlistHook } from "./scripts/sanitize-macos-info-plist";

const config = {
  outDir: process.env.REALM_FORGE_OUT_DIR ?? "out",
  packagerConfig: {
    asar: true,
    appBundleId: "dev.akihisa.realm",
    appCategoryType: "public.app-category.graphics-design",
    name: "Realm",
    extendInfo: {
      LSMinimumSystemVersion: "14.0",
      NSAppTransportSecurity: {
        NSAllowsArbitraryLoads: false,
      },
      CFBundleDocumentTypes: [{
        CFBundleTypeName: "Realm World Map",
        CFBundleTypeRole: "Editor",
        LSHandlerRank: "Owner",
        LSItemContentTypes: ["dev.akihisa.realm.realmmap"],
        CFBundleTypeExtensions: ["realmmap"],
        CFBundleTypeMIMETypes: ["application/x-realmmap"],
      }],
      UTExportedTypeDeclarations: [{
        UTTypeIdentifier: "dev.akihisa.realm.realmmap",
        UTTypeDescription: "Realm World Map",
        UTTypeConformsTo: ["public.data"],
        UTTypeTagSpecification: {
          "public.filename-extension": ["realmmap"],
          "public.mime-type": ["application/x-realmmap"],
        },
      }],
    },
    icon: "assets/icons/icon",
    extraResource: realmPackageExtraResources(process.cwd()),
    ignore: ignoreRealmPackagePath,
    afterComplete: [sanitizeMacInfoPlistHook],
  },
  makers: [new MakerDMG({})],
  plugins: [
    new VitePlugin({
      build: [
        { entry: "src/main/main.ts", config: "vite.main.config.ts" },
        { entry: "src/preload/preload.ts", config: "vite.preload.config.ts" },
      ],
      renderer: [{ name: "main_window", config: "vite.renderer.config.ts" }],
    }),
  ],
};

export default config;
