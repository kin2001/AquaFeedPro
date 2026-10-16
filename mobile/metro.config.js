const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// Browser preview only. Android and iOS resolve every module as before.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === "web") {
    // The browser has localStorage; expo-sqlite's web worker cannot be bundled here.
    if (moduleName === "expo-sqlite/localStorage/install")
      return { type: "empty" };
    // expo-secure-store has no web implementation.
    if (moduleName === "expo-secure-store")
      return {
        type: "sourceFile",
        filePath: path.join(__dirname, "src/lib/web-secure-store.ts"),
      };
  }
  return context.resolveRequest(context, moduleName, platform);
};

// Browser preview only: the Edge Functions send no CORS headers, so the dev server
// forwards same-origin /functions/v1/* calls to the Supabase project. It adds no
// credentials of its own.
const forwardedHeaders = [
  "authorization",
  "apikey",
  "content-type",
  "x-protocol-major",
  "x-request-id",
];
config.server.enhanceMiddleware = (metroMiddleware) => (req, res, next) => {
  if (!req.url.startsWith("/functions/v1/"))
    return metroMiddleware(req, res, next);
  const chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", async () => {
    try {
      const headers = {};
      for (const name of forwardedHeaders)
        if (req.headers[name]) headers[name] = req.headers[name];
      const upstream = await fetch(
        process.env.EXPO_PUBLIC_SUPABASE_URL + req.url,
        {
          method: req.method,
          headers,
          body: chunks.length ? Buffer.concat(chunks) : undefined,
        },
      );
      res.statusCode = upstream.status;
      res.setHeader(
        "content-type",
        upstream.headers.get("content-type") ?? "application/json",
      );
      res.end(Buffer.from(await upstream.arrayBuffer()));
    } catch {
      res.statusCode = 502;
      res.end();
    }
  });
};

module.exports = config;
