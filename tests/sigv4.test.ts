import { describe, expect, it } from "vitest";
import { signSigV4 } from "../src/core/providers/util/sigv4";

/**
 * SigV4 covers a lot of canonicalisation edge cases. We don't exercise the
 * full AWS published test suite (those vectors were authored before the
 * implicit `x-amz-content-sha256` header that Bedrock requires, so the
 * SignedHeaders / Signature wouldn't match byte-for-byte). Instead we lock
 * down the structural invariants plus determinism: same input bytes \u21d2
 * same signature, every time.
 */
describe("signSigV4", () => {
  const TEST_CREDS = {
    accessKeyId: "AKIDEXAMPLE",
    secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
  };
  const FIXED_DATE = new Date("2015-08-30T12:36:00Z");

  function sign(overrides?: { body?: string; url?: string; headers?: Record<string, string> }) {
    return signSigV4({
      method: overrides?.body !== undefined ? "POST" : "GET",
      url: overrides?.url ?? "https://example.amazonaws.com/",
      region: "us-east-1",
      service: "service",
      body: overrides?.body ?? "",
      credentials: TEST_CREDS,
      now: FIXED_DATE,
      headers: overrides?.headers,
    });
  }

  function extractSignature(authz: string): string {
    const m = /Signature=([a-f0-9]{64})/.exec(authz);
    if (!m) throw new Error("no signature in: " + authz);
    return m[1];
  }

  it("is deterministic \u2014 same input always produces the same Authorization", () => {
    const a = sign();
    const b = sign();
    expect(b.headers.authorization).toBe(a.headers.authorization);
  });

  it("emits the canonical credential scope shape", () => {
    const result = sign();
    expect(result.headers.authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/20150830\/us-east-1\/service\/aws4_request, SignedHeaders=[a-z0-9;\-]+, Signature=[a-f0-9]{64}$/,
    );
  });

  it("hashes the empty payload to the well-known SHA-256", () => {
    const result = sign();
    expect(result.headers["x-amz-content-sha256"]).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(result.headers["x-amz-date"]).toBe("20150830T123600Z");
  });

  it("includes user-supplied headers in SignedHeaders alphabetically", () => {
    const result = sign({ headers: { "content-type": "application/json" } });
    expect(result.headers.authorization).toMatch(
      /SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date/,
    );
  });

  it("a 1-byte payload change flips the signature", () => {
    const a = sign({ body: "hello" });
    const b = sign({ body: "hellp" });
    expect(extractSignature(a.headers.authorization)).not.toBe(
      extractSignature(b.headers.authorization),
    );
  });

  it("propagates session token via x-amz-security-token and into the signature", () => {
    const result = signSigV4({
      method: "GET",
      url: "https://example.amazonaws.com/",
      region: "us-east-1",
      service: "service",
      body: "",
      credentials: { ...TEST_CREDS, sessionToken: "FQoXivYXxyzABC" },
      now: FIXED_DATE,
    });
    expect(result.headers["x-amz-security-token"]).toBe("FQoXivYXxyzABC");
    expect(result.headers.authorization).toMatch(/x-amz-security-token/);

    // Without the session token the signature must differ.
    const without = sign();
    expect(extractSignature(result.headers.authorization)).not.toBe(
      extractSignature(without.headers.authorization),
    );
  });

  it("the region is part of the credential scope and the signature key", () => {
    const east = signSigV4({
      method: "GET",
      url: "https://example.amazonaws.com/",
      region: "us-east-1",
      service: "service",
      body: "",
      credentials: TEST_CREDS,
      now: FIXED_DATE,
    });
    const west = signSigV4({
      method: "GET",
      url: "https://example.amazonaws.com/",
      region: "us-west-2",
      service: "service",
      body: "",
      credentials: TEST_CREDS,
      now: FIXED_DATE,
    });
    expect(west.headers.authorization).toContain("us-west-2/service/aws4_request");
    expect(extractSignature(east.headers.authorization)).not.toBe(
      extractSignature(west.headers.authorization),
    );
  });
});
