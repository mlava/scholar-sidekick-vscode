// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

import { verify } from "../src/verify/client";

const opts = {
  apiBase: "https://api.example.test",
  apiKey: "",
  clientVersion: "0.1.3",
};

function okResponse() {
  return new Response(
    JSON.stringify({ ok: true, verdict: "matched", confidence: "high" }),
    {
      status: 200,
      headers: { "content-type": "application/json" },
    },
  );
}

afterEach(() => vi.restoreAllMocks());

describe("verify — semantic title option", () => {
  it("sends no options block by default (the deterministic path)", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(okResponse());
    await verify({ title: "T", doi: "10.1/x" }, opts);
    const body = JSON.parse(
      String((spy.mock.calls[0]![1] as RequestInit).body),
    );
    expect(body.options).toBeUndefined();
  });

  it("sends options.semantic_title when the setting is on", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(okResponse());
    await verify(
      { title: "T", doi: "10.1/x" },
      { ...opts, semanticTitle: true },
    );
    const body = JSON.parse(
      String((spy.mock.calls[0]![1] as RequestInit).body),
    );
    expect(body.options).toEqual({ semantic_title: true });
  });
});
