// @vitest-environment node
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Cross-repo endpoint contract: this extension's REST client
 * (src/verify/client.ts) pins a fixed set of `/api/*` paths on the Scholar
 * Sidekick website (scholar-sidekick repo). If the website renames or removes an
 * endpoint, the extension keeps calling the dead path and breaks only at runtime,
 * with no failing test. This closes that gap.
 *
 * Pattern (shared with scholar-sidekick-mcp / -cli endpoint-contract tests):
 *   - Test 1 is OFFLINE + always-on: reads src/verify/client.ts and asserts the
 *     paths it calls are EXACTLY PINNED_ENDPOINTS — the pinned list can never
 *     silently disagree with the code.
 *   - Test 2 is OPT-IN (CHECK_LIVE_CONTRACT=1): fetches the published OpenAPI spec
 *     and asserts every pinned path is still a documented route — caught on a
 *     daily cron in .github/workflows/ci.yml, off the PR path.
 */

// The `/api/*` paths src/verify/client.ts pins. Keep sorted.
const PINNED_ENDPOINTS = ["/api/oa-check", "/api/retraction-check", "/api/verify"].sort();

const CLIENT_SRC = path.join(process.cwd(), "src", "verify", "client.ts");
const OPENAPI_URL = "https://scholar-sidekick.com/.well-known/openapi.json";

/** Distinct `/api/...` string-literal paths referenced in the client source. */
function endpointsReferencedInClient(): string[] {
  const src = fs.readFileSync(CLIENT_SRC, "utf8");
  const matches = src.match(/["'`](\/api\/[a-z0-9/-]+)["'`]/g) ?? [];
  const paths = matches.map((m) => m.replace(/["'`]/g, ""));
  return Array.from(new Set(paths)).sort();
}

describe("endpoint contract (client REST paths ⇄ website OpenAPI)", () => {
  it("src/verify/client.ts calls exactly the pinned endpoints (keeps the list honest)", () => {
    expect(endpointsReferencedInClient()).toEqual(PINNED_ENDPOINTS);
  });

  it.skipIf(!process.env.CHECK_LIVE_CONTRACT)(
    "every pinned endpoint is still a documented path in the published OpenAPI spec",
    async () => {
      const res = await fetch(OPENAPI_URL, { signal: AbortSignal.timeout(10_000) });
      expect(res.ok, `fetch returned ${res.status}`).toBe(true);
      const spec = (await res.json()) as { paths: Record<string, unknown> };
      const documented = Object.keys(spec.paths);

      for (const pinned of PINNED_ENDPOINTS) {
        expect(
          documented,
          `${pinned} is pinned by src/verify/client.ts but missing from the published OpenAPI spec — the website may have renamed or removed it`,
        ).toContain(pinned);
      }
    },
  );
});
