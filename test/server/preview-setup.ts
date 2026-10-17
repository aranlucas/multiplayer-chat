import { createServer } from "node:http";
import type { TestProject } from "vitest/node";
import { z } from "zod";

/** A real HTTP readiness endpoint, kept outside the Workers test isolate. */
export default async function setup({ provide }: TestProject) {
  const preview = createServer((request, response) => {
    if (request.method !== "GET" || request.url !== "/__relay/ready") {
      response.writeHead(404).end();

      return;
    }

    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ ready: true, roomProtocol: 1, commitSHA: "synthetic-sha" }));
  });

  await new Promise<void>((resolve, reject) => {
    preview.once("error", reject);
    preview.listen(0, "127.0.0.1", resolve);
  });

  const address = z.object({ port: z.number() }).parse(preview.address());

  provide("previewOrigin", `http://127.0.0.1:${address.port}`);

  return () =>
    new Promise<void>((resolve, reject) => {
      preview.close((error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
}
