import { fileURLToPath } from "node:url";
import { createServer } from "vite";

/** Run the fixtures through the same Cloudflare Vite runtime as the application. */
export async function startLocalWorker(mode: "room" | "sdk") {
  const server = await createServer({
    configFile: fileURLToPath(new URL("./fixtures/vite.config.ts", import.meta.url)),
    mode,
    logLevel: "error",
  });

  try {
    await server.listen();
    const origin = server.resolvedUrls?.local[0];

    if (!origin) {
      throw new Error("Local Worker server did not provide a URL");
    }

    return {
      origin,
      fetch: (url: string, init?: RequestInit) => {
        const target = new URL(url);

        return fetch(new URL(target.pathname + target.search, origin), init);
      },
      stop: () => server.close(),
    };
  } catch (error) {
    await server.close();
    throw error;
  }
}
