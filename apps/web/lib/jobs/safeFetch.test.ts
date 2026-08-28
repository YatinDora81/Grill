import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

process.env.GEMINI_API_KEYS ||= "TEST__SPLIT__not-a-real-key";
process.env.JWT_SECRET ||= "test-secret";

let resolved: Record<string, string[]> = {};
const DEFAULT_ADDRESS = "93.184.216.34";

const lookup = mock(async (hostname: string) => {
  const addresses = resolved[hostname] ?? [DEFAULT_ADDRESS];
  if (addresses.length === 0) throw new Error("ENOTFOUND");
  return addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
});
mock.module("node:dns/promises", () => ({ lookup }));

const { assertAllowedHostname, isAddressLiteral, isPrivateAddress, safeFetch, MAX_BYTES } =
  await import("./safeFetch");
const { AppError } = await import("@/lib/errors");

interface Hop {
  status?: number;
  headers?: Record<string, string>;
  body?: string | ReadableStream<Uint8Array>;
}

let hops: Hop[] = [];
let requested: string[] = [];
const realFetch = globalThis.fetch;

beforeEach(() => {
  resolved = {};
  hops = [];
  requested = [];
  globalThis.fetch = mock(async (input: RequestInfo | URL) => {
    requested.push(String(input));
    const hop = hops.shift() ?? { status: 200, headers: { "content-type": "text/html" }, body: "<p>ok</p>" };
    return new Response(hop.body ?? "", {
      status: hop.status ?? 200,
      headers: hop.headers ?? { "content-type": "text/html" },
    });
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

async function refusal(url: string): Promise<string> {
  try {
    await safeFetch(url);
    return "";
  } catch (err) {
    return err instanceof AppError ? err.code : `unexpected: ${String(err)}`;
  }
}

describe("isPrivateAddress", () => {
  test("every range that matters is refused", () => {
    for (const address of [
      "127.0.0.1",
      "127.1.2.3",
      "10.0.0.1",
      "10.255.255.254",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254",
      "169.254.0.1",
      "100.64.0.1",
      "0.0.0.0",
      "0.0.0.1",
      "224.0.0.1",
      "255.255.255.255",
      "198.18.0.1",
    ]) {
      expect(isPrivateAddress(address)).toBe(true);
    }
  });

  test("publicly routable addresses are allowed", () => {
    for (const address of ["93.184.216.34", "8.8.8.8", "172.32.0.1", "172.15.0.1", "1.1.1.1"]) {
      expect(isPrivateAddress(address)).toBe(false);
    }
  });

  test("IPv6 loopback, unique-local, link-local and multicast are refused", () => {
    for (const address of ["::1", "::", "fc00::1", "fd12:3456::1", "fe80::1", "ff02::1"]) {
      expect(isPrivateAddress(address)).toBe(true);
    }
  });

  test("an IPv4-mapped IPv6 address is judged by the address it carries", () => {
    expect(isPrivateAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isPrivateAddress("::ffff:169.254.169.254")).toBe(true);
    expect(isPrivateAddress("::ffff:93.184.216.34")).toBe(false);
  });

  test("a public IPv6 address is allowed", () => {
    expect(isPrivateAddress("2606:2800:220:1:248:1893:25c8:1946")).toBe(false);
  });

  test("anything that isn't an address at all is refused rather than guessed at", () => {
    expect(isPrivateAddress("not-an-address")).toBe(true);
    expect(isPrivateAddress("")).toBe(true);
    expect(isPrivateAddress("999.999.999.999")).toBe(true);
  });
});

describe("isAddressLiteral catches every notation for an address", () => {
  test("the canonical forms", () => {
    expect(isAddressLiteral("127.0.0.1")).toBe(true);
    expect(isAddressLiteral("192.168.0.1")).toBe(true);
    expect(isAddressLiteral("[::1]")).toBe(true);
    expect(isAddressLiteral("::1")).toBe(true);
  });

  test("the encodings that a naive check misses — all of these are 127.0.0.1", () => {
    expect(isAddressLiteral("2130706433")).toBe(true);
    expect(isAddressLiteral("0x7f000001")).toBe(true);
    expect(isAddressLiteral("0177.0.0.1")).toBe(true);
    expect(isAddressLiteral("127.1")).toBe(true);
    expect(isAddressLiteral("7f000001")).toBe(true);
  });

  test("real hostnames are not literals", () => {
    for (const host of ["example.com", "boards.greenhouse.io", "careers.acme.co.uk", "a1.b2.test"]) {
      expect(isAddressLiteral(host)).toBe(false);
    }
  });
});

describe("assertAllowedHostname", () => {
  test("localhost and the private-network suffixes are refused by name alone", () => {
    for (const host of [
      "localhost",
      "LOCALHOST",
      "printer.local",
      "metadata.internal",
      "db.lan",
      "app.localhost",
      "svc.home.arpa",
    ]) {
      expect(() => assertAllowedHostname(host)).toThrow();
    }
  });

  test("a trailing dot does not slip past the suffix check", () => {
    expect(() => assertAllowedHostname("metadata.internal.")).toThrow();
    expect(() => assertAllowedHostname("localhost.")).toThrow();
  });

  test("an ordinary public host passes", () => {
    expect(() => assertAllowedHostname("boards.greenhouse.io")).not.toThrow();
    expect(() => assertAllowedHostname("careers.acme.com")).not.toThrow();
  });
});

describe("safeFetch refuses before it connects", () => {
  test("http:// never reaches the network", async () => {
    expect(await refusal("http://careers.acme.com/job")).toBe("blocked_url");
    expect(requested).toEqual([]);
  });

  test("an IP literal never reaches the network, in any notation", async () => {
    for (const host of ["169.254.169.254", "127.0.0.1", "2130706433", "0x7f000001", "[::1]"]) {
      expect(await refusal(`https://${host}/latest/meta-data/`)).toBe("blocked_url");
    }
    expect(requested).toEqual([]);
  });

  test("a hostname that RESOLVES to a private address is refused", async () => {
    resolved["evil.test"] = ["169.254.169.254"];
    expect(await refusal("https://evil.test/job")).toBe("blocked_url");
    expect(requested).toEqual([]);
  });

  test("ALL resolved addresses are checked, not just the first", async () => {
    resolved["split.test"] = ["93.184.216.34", "10.0.0.5"];
    expect(await refusal("https://split.test/job")).toBe("blocked_url");
    expect(requested).toEqual([]);
  });

  test("a name that resolves to nothing is a clean refusal", async () => {
    resolved["nowhere.test"] = [];
    expect(await refusal("https://nowhere.test/job")).toBe("host_not_found");
  });

  test("a public host is fetched", async () => {
    const res = await safeFetch("https://careers.acme.com/job");
    expect(res.status).toBe(200);
    expect(res.body).toBe("<p>ok</p>");
    expect(requested).toEqual(["https://careers.acme.com/job"]);
  });
});

describe("redirects are re-checked at every hop", () => {
  test("a redirect to http:// is refused", async () => {
    hops = [{ status: 302, headers: { location: "http://careers.acme.com/job" } }];
    expect(await refusal("https://careers.acme.com/start")).toBe("blocked_url");
    expect(requested).toHaveLength(1);
  });

  test("a redirect to the metadata service is refused", async () => {
    hops = [{ status: 302, headers: { location: "https://169.254.169.254/latest/meta-data/" } }];
    expect(await refusal("https://careers.acme.com/start")).toBe("blocked_url");
  });

  test("a redirect to a name that resolves privately is refused", async () => {
    resolved["inside.test"] = ["10.1.2.3"];
    hops = [{ status: 302, headers: { location: "https://inside.test/x" } }];
    expect(await refusal("https://careers.acme.com/start")).toBe("blocked_url");
    expect(requested).toEqual(["https://careers.acme.com/start"]);
  });

  test("a relative Location is resolved against the current URL and then re-checked", async () => {
    hops = [
      { status: 301, headers: { location: "/jobs/42" } },
      { status: 200, headers: { "content-type": "text/html" }, body: "<p>posting</p>" },
    ];
    const res = await safeFetch("https://careers.acme.com/old");
    expect(requested).toEqual(["https://careers.acme.com/old", "https://careers.acme.com/jobs/42"]);
    expect(res.url).toBe("https://careers.acme.com/jobs/42");
  });

  test("three hops are followed; a fourth is refused", async () => {
    hops = [
      { status: 302, headers: { location: "https://a.test/1" } },
      { status: 302, headers: { location: "https://a.test/2" } },
      { status: 302, headers: { location: "https://a.test/3" } },
      { status: 302, headers: { location: "https://a.test/4" } },
    ];
    expect(await refusal("https://a.test/0")).toBe("too_many_redirects");
    expect(requested).toHaveLength(4);
  });

  test("a redirect with no Location is a clean failure, not a hang", async () => {
    hops = [{ status: 302, headers: {} }];
    expect(await refusal("https://a.test/0")).toBe("fetch_failed");
  });
});

describe("the response itself is bounded", () => {
  test("the 2 MB cap is enforced WHILE streaming, so the whole body is never buffered", async () => {
    const chunk = new TextEncoder().encode("x".repeat(64 * 1024));
    let delivered = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        delivered += chunk.byteLength;
        controller.enqueue(chunk);
      },
    });
    hops = [{ status: 200, headers: { "content-type": "text/html" }, body: stream }];

    expect(await refusal("https://big.test/job")).toBe("page_too_large");
    expect(delivered).toBeLessThan(MAX_BYTES * 2);
  });

  test("a body just under the cap is returned", async () => {
    const body = "y".repeat(1024);
    hops = [{ status: 200, headers: { "content-type": "text/html" }, body }];
    const res = await safeFetch("https://ok.test/job");
    expect(res.body).toHaveLength(1024);
  });

  test("only text/html and application/json are accepted", async () => {
    for (const type of ["application/pdf", "image/png", "text/plain", "application/octet-stream"]) {
      hops = [{ status: 200, headers: { "content-type": type }, body: "…" }];
      expect(await refusal("https://ok.test/job")).toBe("unsupported_content");
    }
    hops = [{ status: 200, headers: { "content-type": "application/json; charset=utf-8" }, body: "{}" }];
    expect((await safeFetch("https://ok.test/job")).contentType).toBe("application/json");
  });
});

describe("login walls are named, not shrugged at", () => {
  test("401, 403 and LinkedIn's 999 all become login_wall", async () => {
    for (const status of [401, 403, 999]) {
      hops = [{ status, headers: { "content-type": "text/html" }, body: "<p>nope</p>" }];
      expect(await refusal("https://www.linkedin.com/jobs/view/1")).toBe("login_wall");
    }
  });

  test("a 200 sign-in page with almost no text is a login wall too", async () => {
    hops = [
      {
        status: 200,
        headers: { "content-type": "text/html" },
        body: "<html><head><title>Sign In | LinkedIn</title></head><body><form>Email</form></body></html>",
      },
    ];
    expect(await refusal("https://www.linkedin.com/jobs/view/1")).toBe("login_wall");
  });

  test("a real posting whose title happens to say 'login' is NOT a login wall", async () => {
    const body = `<html><head><title>Engineer, Login Services</title></head><body><p>${"Own the auth stack. ".repeat(
      60,
    )}</p></body></html>`;
    hops = [{ status: 200, headers: { "content-type": "text/html" }, body }];
    const res = await safeFetch("https://careers.acme.com/job");
    expect(res.status).toBe(200);
  });

  test("an upstream 500 does not leak its body back to the caller", async () => {
    hops = [{ status: 500, headers: { "content-type": "text/html" }, body: "<pre>stack trace: /srv/app</pre>" }];
    try {
      await safeFetch("https://careers.acme.com/job");
      throw new Error("expected a refusal");
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).message).not.toContain("stack trace");
      expect((err as AppError).code).toBe("fetch_failed");
    }
  });

  test("a network failure is a clean 400, never a hang or a leaked reason", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("connect ECONNREFUSED 10.0.0.1:443");
    }) as unknown as typeof fetch;
    try {
      await safeFetch("https://careers.acme.com/job");
      throw new Error("expected a refusal");
    } catch (err) {
      expect((err as AppError).code).toBe("fetch_failed");
      expect((err as AppError).message).not.toContain("10.0.0.1");
    }
  });
});
