import type { BrowserWindow, Event } from "electron";

function isHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function installWindowSecurityPolicy(
  window: BrowserWindow,
  allowedNavigation: (url: string) => boolean,
  options: { devServerUrl?: string | undefined } = {},
): () => void {
  const { webContents } = window;
  const deny = (event: Event, url: string): void => {
    if (!allowedNavigation(url)) event.preventDefault();
  };
  const denyWebview = (event: Event): void => event.preventDefault();
  const denyPermission = (_contents: Electron.WebContents, _permission: string, callback: (allowed: boolean) => void): void => callback(false);
  const denyOpen = ({ url }: { url: string }): { action: "deny" } => {
    // External links are intentionally denied. Realm is an offline editor.
    void url;
    return { action: "deny" };
  };
  const contentSecurityPolicy = rendererContentSecurityPolicy(options.devServerUrl);
  const onHeadersReceived = (details: Electron.OnHeadersReceivedListenerDetails, callback: (response: Electron.HeadersReceivedResponse) => void): void => {
    const responseHeaders = { ...details.responseHeaders };
    for (const key of Object.keys(responseHeaders)) if (key.toLowerCase() === "content-security-policy") delete responseHeaders[key];
    responseHeaders["Content-Security-Policy"] = [contentSecurityPolicy];
    callback({ responseHeaders });
  };

  webContents.on("will-navigate", deny);
  webContents.on("will-redirect", deny);
  webContents.on("will-attach-webview", denyWebview);
  webContents.setWindowOpenHandler(denyOpen);
  webContents.session.setPermissionRequestHandler(denyPermission);
  webContents.session.webRequest?.onHeadersReceived(onHeadersReceived);

  const cleanup = (): void => {
    webContents.removeListener("will-navigate", deny);
    webContents.removeListener("will-redirect", deny);
    webContents.removeListener("will-attach-webview", denyWebview);
    webContents.session.setPermissionRequestHandler(null);
    webContents.session.webRequest?.onHeadersReceived(null);
  };
  window.once("closed", cleanup);
  return cleanup;
}

export function isAllowedRendererNavigation(url: string, rendererUrl: string, devServerUrl?: string): boolean {
  if (devServerUrl) {
    try {
      const target = new URL(url);
      const dev = new URL(devServerUrl);
      return target.protocol === dev.protocol && target.hostname === dev.hostname && target.port === dev.port;
    } catch {
      return false;
    }
  }
  return url === rendererUrl || url.startsWith(`${rendererUrl}#`);
}

export function rendererContentSecurityPolicy(devServerUrl?: string): string {
  const connectSources = ["'self'"];
  if (devServerUrl) {
    try {
      const origin = new URL(devServerUrl).origin;
      const wsOrigin = origin.replace(/^http/i, "ws");
      connectSources.push(origin, wsOrigin);
    } catch { /* malformed dev URLs are rejected by navigation policy */ }
  }
  return [
    "default-src 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'none'",
    `script-src 'self'${devServerUrl ? " 'unsafe-inline'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "worker-src 'self' blob:",
    `connect-src ${connectSources.join(" ")}`,
  ].join("; ");
}

export function isSafeExternalUrl(url: string): boolean {
  return isHttpUrl(url) && false;
}
