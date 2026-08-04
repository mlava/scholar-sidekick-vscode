// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clientTag, verify } from "../src/verify/client";

/**
 * The `X-Scholar-Client` handshake tag is how the server attributes this
 * extension's traffic to the `vscode` usage surface.
 *
 * This test exists because the tag was missing for the whole of v0.1.0: the
 * server had a `vscode` surface, this client never sent the tag, so every call
 * was recorded as generic `api` traffic with a NULL client and the surface
 * reported zero rows. A one-line header is trivially easy to drop again during
 * a refactor and impossible to notice from inside this repo, so it is asserted
 * rather than assumed.
 *
 * The server parses `scholar-sidekick-<name>[/<version>]` and maps `<name>`
 * through a CLOSED lookup table — an unrecognised name silently falls through
 * to the generic `api` surface. So the suffix must stay exactly `vscode`.
 */

const SERVER_CLIENT_TAG = /^scholar-sidekick-([a-z][a-z0-9-]*)(?:\/([a-z0-9.+-]+))?$/i;

describe("clientTag", () => {
  it("uses the exact suffix the server maps to the vscode surface", () => {
    expect(clientTag("0.1.0")).toBe("scholar-sidekick-vscode/0.1.0");
    expect(clientTag("0.1.0").split("/")[0]).toBe("scholar-sidekick-vscode");
  });

  it("matches the server's tag grammar, with and without a version", () => {
    expect(clientTag("0.1.0")).toMatch(SERVER_CLIENT_TAG);
    expect(clientTag()).toMatch(SERVER_CLIENT_TAG);
  });

  it("still identifies the surface when no version is known", () => {
    // The server's grammar makes the version optional, so a caller that forgets
    // to thread it loses `client_version` but never the surface attribution.
    expect(clientTag()).toBe("scholar-sidekick-vscode");
    expect(clientTag(undefined)).toBe("scholar-sidekick-vscode");
    expect(clientTag("")).toBe("scholar-sidekick-vscode");
  });

  it("drops a version that would produce an unparseable tag", () => {
    // A malformed version must not break the whole tag — losing the version is
    // recoverable, losing the surface is not.
    expect(clientTag("1.0.0 (dev build)")).toBe("scholar-sidekick-vscode");
    expect(clientTag("../../etc")).toBe("scholar-sidekick-vscode");
    // Pre-release and build-metadata versions are legitimate and kept.
    expect(clientTag("1.2.0-beta.1")).toBe("scholar-sidekick-vscode/1.2.0-beta.1");
  });
});

describe("every request carries the client tag", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, verdict: "matched" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function sentHeaders(): Record<string, string> {
    expect(fetchMock).toHaveBeenCalled();
    return (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
  }

  it("sends x-scholar-client on a verify call", async () => {
    await verify(
      { title: "A paper", doi: "10.1038/nphys1170" },
      { apiBase: "https://example.test", apiKey: "", clientVersion: "0.1.0" },
    );
    expect(sentHeaders()["x-scholar-client"]).toBe("scholar-sidekick-vscode/0.1.0");
  });

  it("sends the tag even when the version was never threaded through", async () => {
    await verify(
      { title: "A paper", doi: "10.1038/nphys1170" },
      { apiBase: "https://example.test", apiKey: "" },
    );
    expect(sentHeaders()["x-scholar-client"]).toBe("scholar-sidekick-vscode");
  });

  it("sends the tag anonymously, not only when a key is configured", async () => {
    await verify(
      { title: "A paper", doi: "10.1038/nphys1170" },
      { apiBase: "https://example.test", apiKey: "" },
    );
    const headers = sentHeaders();
    expect(headers["x-scholar-client"]).toMatch(SERVER_CLIENT_TAG);
    expect(headers.authorization).toBeUndefined();
  });
});
