import { createHash, createHmac } from "node:crypto";

/**
 * Pure-TypeScript implementation of **AWS Signature Version 4** signing.
 *
 * No dependency on `@aws-sdk/*`. We implement only what NexusCode needs to
 * call AWS Bedrock's Converse and ConverseStream HTTP APIs:
 *
 * - SHA-256 over the request payload (the "x-amz-content-sha256" header).
 * - Canonical request → string-to-sign → derived signing key → signature.
 * - `Authorization: AWS4-HMAC-SHA256 Credential=…, SignedHeaders=…, Signature=…`.
 *
 * Reference: https://docs.aws.amazon.com/general/latest/gr/sigv4_signing.html
 */
export interface SigV4Credentials {
  accessKeyId: string;
  secretAccessKey: string;
  /** Optional STS session token. Set on assume-role / federation flows. */
  sessionToken?: string;
}

export interface SigV4SignParams {
  method: string;
  /** Full URL (https://host/path?query). Path and query are extracted from it. */
  url: string;
  region: string;
  service: string;
  body: string | Uint8Array;
  /** Headers to include in the canonical request. Host + x-amz-date are added automatically. */
  headers?: Record<string, string>;
  /** Override the request date. Defaults to `new Date()`. */
  now?: Date;
  credentials: SigV4Credentials;
}

export interface SigV4SignResult {
  headers: Record<string, string>;
  /** The full URL — unchanged from the input, returned for convenience. */
  url: string;
}

/** Sign a request and return the headers needed to send it. */
export function signSigV4(p: SigV4SignParams): SigV4SignResult {
  const url = new URL(p.url);
  const now = p.now ?? new Date();
  const amzDate = isoCompactUtc(now); // 20240115T123045Z
  const dateStamp = amzDate.slice(0, 8); // 20240115

  const bodyBytes =
    typeof p.body === "string" ? new TextEncoder().encode(p.body) : p.body;
  const payloadHash = sha256Hex(bodyBytes);

  const baseHeaders: Record<string, string> = {
    host: url.host,
    "x-amz-date": amzDate,
    "x-amz-content-sha256": payloadHash,
    ...(p.credentials.sessionToken
      ? { "x-amz-security-token": p.credentials.sessionToken }
      : {}),
    ...lowerKeys(p.headers ?? {}),
  };

  const signedHeaderNames = Object.keys(baseHeaders).sort();
  const canonicalHeaders =
    signedHeaderNames
      .map((h) => `${h}:${normalizeHeaderValue(baseHeaders[h])}\n`)
      .join("") || "\n";
  const signedHeaders = signedHeaderNames.join(";");

  const canonicalRequest = [
    p.method.toUpperCase(),
    canonicalUriFromPathname(url.pathname),
    canonicalQueryString(url.searchParams),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${p.region}/${p.service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(new TextEncoder().encode(canonicalRequest)),
  ].join("\n");

  const signingKey = deriveSigningKey(
    p.credentials.secretAccessKey,
    dateStamp,
    p.region,
    p.service,
  );
  const signature = hmacHex(signingKey, stringToSign);

  const authHeader = `AWS4-HMAC-SHA256 Credential=${p.credentials.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    headers: {
      ...baseHeaders,
      authorization: authHeader,
    },
    url: p.url,
  };
}

function deriveSigningKey(
  secret: string,
  dateStamp: string,
  region: string,
  service: string,
): Buffer {
  const kDate = hmac(`AWS4${secret}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, "aws4_request");
}

function hmac(key: string | Buffer, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

function hmacHex(key: Buffer, data: string): string {
  return createHmac("sha256", key).update(data, "utf8").digest("hex");
}

function sha256Hex(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

function isoCompactUtc(d: Date): string {
  // YYYYMMDDTHHMMSSZ
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

function normalizeHeaderValue(v: string): string {
  // Trim and collapse internal whitespace runs (per SigV4 spec).
  return v.trim().replace(/\s+/g, " ");
}

function lowerKeys(o: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(o)) out[k.toLowerCase()] = v;
  return out;
}

/**
 * AWS expects the canonical URI to be RFC 3986 percent-encoded **but** with
 * forward slashes preserved for non-S3 services. Bedrock falls under the
 * non-S3 rule, which is what we encode here.
 */
function canonicalUriFromPathname(pathname: string): string {
  if (!pathname) return "/";
  return pathname
    .split("/")
    .map((seg) => awsUriEncode(seg, /*encodeSlash*/ false))
    .join("/");
}

function canonicalQueryString(params: URLSearchParams): string {
  const entries: [string, string][] = [];
  params.forEach((value, key) => entries.push([key, value]));
  entries.sort(([ak, av], [bk, bv]) => (ak === bk ? (av < bv ? -1 : av > bv ? 1 : 0) : ak < bk ? -1 : 1));
  return entries
    .map(([k, v]) => `${awsUriEncode(k, true)}=${awsUriEncode(v, true)}`)
    .join("&");
}

/**
 * AWS-flavoured percent-encoding: encodes everything except
 * `A-Z / a-z / 0-9 / - / _ / . / ~` (and optionally `/`).
 */
function awsUriEncode(input: string, encodeSlash: boolean): string {
  let out = "";
  for (const c of input) {
    if (
      (c >= "A" && c <= "Z") ||
      (c >= "a" && c <= "z") ||
      (c >= "0" && c <= "9") ||
      c === "-" ||
      c === "_" ||
      c === "." ||
      c === "~"
    ) {
      out += c;
    } else if (c === "/" && !encodeSlash) {
      out += "/";
    } else {
      const bytes = new TextEncoder().encode(c);
      for (const b of bytes) out += `%${b.toString(16).toUpperCase().padStart(2, "0")}`;
    }
  }
  return out;
}
