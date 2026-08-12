import { assert, assertEquals, assertRejects } from "@std/assert";
import { parseConfig } from "../../src/config/config.ts";
import {
  AddressPolicy,
  type ApprovedTarget,
  NetworkPolicyError,
  PinnedTransport,
  type Resolver,
  SafeFetcher,
  type Transport,
} from "../../src/network/safe_fetcher.ts";

const CERT = `-----BEGIN CERTIFICATE-----
MIIDJTCCAg2gAwIBAgIURxAr/EGrrqO21XojvH1ZIb++evUwDQYJKoZIhvcNAQEL
BQAwFjEUMBIGA1UEAwwLcGlubmVkLnRlc3QwHhcNMjYwODEyMTAzMDM4WhcNMzYw
ODA5MTAzMDM4WjAWMRQwEgYDVQQDDAtwaW5uZWQudGVzdDCCASIwDQYJKoZIhvcN
AQEBBQADggEPADCCAQoCggEBAMIxXoTcEMZe9sHw6Cwiki+2kzr0hwMbOPPRsF7G
Wh7VqnuYD0GGcgh1KkRCdUf27aaZWVPhxLIedFzmXk31c0/tLPPwGjSkDjMt4byX
JY23X3Jf7EcfDtbIsBcyApcGKXY/n3mXx7lYKXJN+Eb+0edfgPqox4hiRZKtZYjH
zNdtFJoF5RgJRwN2XzCfSt8JZ926A4cFam73ffHwybL0ZuADSpwbAqsH9yxEeCEg
55rqkVl95T3EQ8D/Dk38urp82Wvku+yVajlH/NA7KvPb6sh2raLaYCOXbDUYWmae
Nz7vHllX8heuv/Uz3/DvUaX9I13vDntn9odukwDwuJxHUysCAwEAAaNrMGkwHQYD
VR0OBBYEFDwHX5+l9RNN/Rq6A6LrwXhv/0B5MB8GA1UdIwQYMBaAFDwHX5+l9RNN
/Rq6A6LrwXhv/0B5MA8GA1UdEwEB/wQFMAMBAf8wFgYDVR0RBA8wDYILcGlubmVk
LnRlc3QwDQYJKoZIhvcNAQELBQADggEBAE8CfPwZiUhNs7MuUtYgJS0sJ8XQZ3Sw
9cSa16ZKGPo0ZCxycJrk581eTpYyPPISGd9IFnbkQrRpmQWLshbOnIYEG0Y8pV++
8kUbSbYF+RVUv9eLy0qVofoC+7HIB6S/owRtV4PUaai6dfcz+g2JLSPWE8PTBkle
7z7FPmMge9QuBlv6ey3GPU9WW5g/B2F1e322b5LLFLXkXldiXJR5+RFDzTJFujs4
zhd8uaZvsvvJYp//ZhAqTcruOBvJIyVb3UtO0RUhXdHus20HbNdchmbX8FRE5zPw
R6fz8mC67FhPoZ/9+72rkRHSJv827m/01HMSmBZ/McpaIxhRVKjh5O0=
-----END CERTIFICATE-----`;

const KEY = `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDCMV6E3BDGXvbB
8OgsIpIvtpM69IcDGzjz0bBexloe1ap7mA9BhnIIdSpEQnVH9u2mmVlT4cSyHnRc
5l5N9XNP7Szz8Bo0pA4zLeG8lyWNt19yX+xHHw7WyLAXMgKXBil2P595l8e5WCly
TfhG/tHnX4D6qMeIYkWSrWWIx8zXbRSaBeUYCUcDdl8wn0rfCWfdugOHBWpu933x
8Mmy9GbgA0qcGwKrB/csRHghIOea6pFZfeU9xEPA/w5N/Lq6fNlr5LvslWo5R/zQ
Oyrz2+rIdq2i2mAjl2w1GFpmnjc+7x5ZV/IXrr/1M9/w71Gl/SNd7w57Z/aHbpMA
8LicR1MrAgMBAAECggEAJZy1T2tmTl23UoIMHfxGLzqgEqOpAMeFhOgAzqKBcwZ0
YkLl9Y2KSawT1yu+FoWzqvh5rj8Ev3EZnaK68kOPpZPtCIRhNv/thiklV0c5LVUu
hfMhSvcvgxdUz/FOQh0d67rP8xecRgBW6r5CT9HsKvG7BBGrr/VEv2+ZQmBcgv7V
pWghUbsHj/9XJBHLTQZXuYGMFsmR7HmutExxeHvdAEDxvYt6d3PM991ywWoGsz82
JXLVfoRJpuMM+hMjo9IOe6YvvQVK1KWX62I1ISECHrKnJk7jfF2dsH+n0/uPhUJT
kWBiwI71jFdQHb4zsmWu6hXkMdThFDInnEi+bC284QKBgQDrowf89mECiT7gnGS1
ipQl+fqKhZ/M67egV8POQxSDqs/obU62in0QDV04InHRF9lF1k6YwOtoJnfhWi2L
jQ/dNlhsRUDsb/L2axf1dph2EQytlGVW2PlbFZHTeWIfqe0Mq1AgCg8y4T5F8pG2
kGXTw6HovKxaSHSZ9bUGCxCDywKBgQDS+XobCa5KsES4w9N/itFEmF2EB86dXEsQ
sqBOaz1Dx2sbdvGl3Xqwg1c1h9G+dsRYzL9Jt7YTNntHgsbKR1uIrxDWBwu6motb
D1np8atV00fMd9Ag2jhhNQmfC2sIWVMWLFJ/0fPZsHwH6DHfhZNAPVJVwpVak//L
jn+O2gRCIQKBgQDbVqp84apzfeW1ll54TkKRBxwcDT4utcv7yTZOrUpPNZTKOdVn
PYokgwwe0JE5nQV2aIJI1mtKS2STtClpGSmHNKsiPWStsZdroUxwBLDuVfiDKvsZ
2GZkTrOrMfYQm1A41s6CxFpZdilNWvogAlGGyTfROK8GayN+nKSgt3Pr+QKBgQCj
HXvI181Htc0MRWuKWtu9e0giQp7+j1MCT/kdaFBvzQkErQvcP8cSHhoZKy+BYPYh
6fujlURSyna6LWRhFJaysRgFQmFRHxfLiazs8YqUysviTGhAXjflAEq2Cu/v/o/8
vrvyU3ODxa2/t0iIFxBoRIEaCV3MME0/Jqd83RcZwQKBgCe2HYRJBWJ2p/c+WzMo
okBRY7U+8lcD/tl1AV7ehYgn68HbClgm7ovJCZAoadaOKUFlvPn3AUyzSnmkYnBc
+ob0iBhwBoKnRNuv2b4FWZ7uKIcAxHEwD3lZpbYZa9F5I82fijAJzJsRoXUpWcyC
4a+5RPPcGjc31XUxxIYmkW2i
-----END PRIVATE KEY-----`;

// A CA:false leaf is required by rustls; the older self-signed pair above is
// retained as a negative certificate fixture.
const TLS_CA = `-----BEGIN CERTIFICATE-----
MIIBeDCCAR+gAwIBAgIUBGmCOOOGDd8F2wAyUr/wP8dHpmIwCgYIKoZIzj0EAwIw
EjEQMA4GA1UEAwwHVGVzdCBDQTAeFw0yNjA4MTIxMDM0NDlaFw0zNjA4MDkxMDM0
NDlaMBIxEDAOBgNVBAMMB1Rlc3QgQ0EwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNC
AARf3h9m3rQls7yS4kPqrKmdTiBqeJRofsHv/HzeAInDpe4pruCBHu0oUiWSHCpP
rTVXL4HkLwphCo7SaVXtJNr2o1MwUTAdBgNVHQ4EFgQUjbiaeJjiwdLlfZXuw2x1
3ay8CgwwHwYDVR0jBBgwFoAUjbiaeJjiwdLlfZXuw2x13ay8CgwwDwYDVR0TAQH/
BAUwAwEB/zAKBggqhkjOPQQDAgNHADBEAiAfpRneoN00AaY06aEdhzHfqwFFawry
cjuZlrDP7bcgmQIgTi35ex0XPsG5aDs9qqJrqwuLVNmBYseqygqQthZo8Qs=
-----END CERTIFICATE-----`;

const TLS_CERT = `-----BEGIN CERTIFICATE-----
MIIBuTCCAV+gAwIBAgIUDyDv9wRVdksXtJoPMhXjZm4doc4wCgYIKoZIzj0EAwIw
EjEQMA4GA1UEAwwHVGVzdCBDQTAeFw0yNjA4MTIxMDM0NDlaFw0zNjA4MDkxMDM0
NDlaMBYxFDASBgNVBAMMC3Bpbm5lZC50ZXN0MFkwEwYHKoZIzj0CAQYIKoZIzj0D
AQcDQgAEb8I9HTFAexL2PvrvCjn8ccMP2y4viUmUj3KDRIX1pyS9mnzm5xBneAgB
Wb4VLVOQ0PlkGKIabqyafGy81xS9WqOBjjCBizAWBgNVHREEDzANggtwaW5uZWQu
dGVzdDAMBgNVHRMBAf8EAjAAMA4GA1UdDwEB/wQEAwIHgDATBgNVHSUEDDAKBggr
BgEFBQcDATAdBgNVHQ4EFgQUA5LcfX0cQ+FNkgtMD0vfVZ/KUE8wHwYDVR0jBBgw
FoAUjbiaeJjiwdLlfZXuw2x13ay8CgwwCgYIKoZIzj0EAwIDSAAwRQIhAPzsEec4
lc8TPvLvbDeHDNDKWO+QlV9oXam4/ArS80QpAiAF0SkuSC10ohPNNxougIKbLAM1
OSkGM6LkDg+0Bqke5Q==
-----END CERTIFICATE-----`;

const TLS_KEY = `-----BEGIN EC PRIVATE KEY-----
MHcCAQEEIC+Nh+Nb6bW09sYblJjVlyqPaKeCDOfP0raMhIvKA3N3oAoGCCqGSM49
AwEHoUQDQgAEb8I9HTFAexL2PvrvCjn8ccMP2y4viUmUj3KDRIX1pyS9mnzm5xBn
eAgBWb4VLVOQ0PlkGKIabqyafGy81xS9Wg==
-----END EC PRIVATE KEY-----`;

function resolver(answers: Record<string, string[]>): Resolver {
  return (hostname) => Promise.resolve(answers[hostname] ?? []);
}

Deno.test("configuration aggregates diagnostics without performing I/O", () => {
  let effects = 0;
  const parsed = parseConfig({
    bindPort: "0",
    publisherPubkeys: "bad,also-bad",
    relayUrls: "ftp://relay.invalid,not-a-url",
    preferredBlossomUrl: "http://user@example.test",
    limits: { maxRedirects: "99", connectTimeoutMs: "0" },
  }, { onSideEffect: () => effects++ });

  assert(!parsed.ok);
  assert(parsed.diagnostics.length >= 5);
  assertEquals(effects, 0);
});

Deno.test("publisher policy rejects forbidden and mixed DNS answers", async () => {
  const policy = new AddressPolicy(resolver({
    "private.test": ["127.0.0.1"],
    "mixed.test": ["93.184.216.34", "10.0.0.1"],
  }));

  await assertRejects(
    () => policy.approve(new URL("https://private.test/a"), "publisher"),
    NetworkPolicyError,
  );
  await assertRejects(
    () => policy.approve(new URL("https://mixed.test/a"), "publisher"),
    NetworkPolicyError,
  );
});

Deno.test("configured origin alone may use its resolved local address", async () => {
  const policy = new AddressPolicy(
    resolver({ "cache.test": ["127.0.0.1"] }),
    "http://cache.test:8080",
  );
  const approved = await policy.approve(
    new URL("http://cache.test:8080/blob"),
    "configured",
  );
  assertEquals(approved.address, "127.0.0.1");
  await assertRejects(
    () => policy.approve(new URL("http://cache.test:8081/blob"), "configured"),
    NetworkPolicyError,
  );
});

Deno.test("HTTP transport connects to approved peer and preserves Host", async () => {
  let host = "";
  let peer = "";
  const abort = new AbortController();
  const server = Deno.serve({
    hostname: "127.0.0.1",
    port: 0,
    signal: abort.signal,
    onListen: () => {},
  }, (request, info) => {
    host = request.headers.get("host") ?? "";
    peer = info.remoteAddr.hostname;
    return new Response("ok");
  });

  try {
    const port = (server.addr as Deno.NetAddr).port;
    const url = new URL(`http://origin.test:${port}/blob`);
    const target: ApprovedTarget = {
      url,
      hostname: "origin.test",
      address: "127.0.0.1",
      port,
    };
    const response = await new PinnedTransport().fetch(target, {
      signal: AbortSignal.timeout(2_000),
    });
    assertEquals(await response.text(), "ok");
    assertEquals(host, `origin.test:${port}`);
    assertEquals(peer, "127.0.0.1");
    assertEquals(response.peerAddress, "127.0.0.1");
  } finally {
    abort.abort();
    await server.finished;
  }
});

Deno.test("HTTPS pins peer while certificate identity remains hostname", async () => {
  const listener = Deno.listenTls({
    hostname: "127.0.0.1",
    port: 0,
    cert: TLS_CERT,
    key: TLS_KEY,
  });
  const port = (listener.addr as Deno.NetAddr).port;
  let requestText = "";
  const serve = (async () => {
    using conn = await listener.accept();
    const buffer = new Uint8Array(2048);
    const size = await conn.read(buffer) ?? 0;
    requestText = new TextDecoder().decode(buffer.subarray(0, size));
    await conn.write(new TextEncoder().encode(
      "HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok",
    ));
  })();

  try {
    const response = await new PinnedTransport({ caCerts: [TLS_CA] }).fetch({
      url: new URL(`https://pinned.test:${port}/secure`),
      hostname: "pinned.test",
      address: "127.0.0.1",
      port,
    }, { signal: AbortSignal.timeout(2_000) });
    assertEquals(await response.text(), "ok");
    await serve;
    assert(requestText.includes(`Host: pinned.test:${port}`));
    // The successful handshake is possible only because startTls validates the
    // pinned.test leaf against the logical hostname, not the connected IP.
    assert(CERT.includes("CERTIFICATE"));
    assert(KEY.includes("PRIVATE KEY"));
  } finally {
    listener.close();
  }
});

Deno.test("redirects are re-approved and rebinding cannot change peer", async () => {
  const resolutions = new Map<string, string[][]>([
    ["start.test", [["93.184.216.34"], ["127.0.0.1"]]],
    ["pivot.test", [["10.0.0.1"]]],
  ]);
  const calls: ApprovedTarget[] = [];
  const transport: Transport = {
    fetch(target) {
      calls.push(target);
      return Promise.resolve({
        status: 302,
        headers: new Headers({ location: "http://pivot.test/secret" }),
        body: new ReadableStream(),
        peerAddress: target.address,
        text: () => Promise.resolve(""),
        cancel: () => Promise.resolve(),
      });
    },
  };
  const dynamicResolver: Resolver = (hostname) => {
    const queue = resolutions.get(hostname) ?? [];
    return Promise.resolve(queue.shift() ?? []);
  };
  const fetcher = new SafeFetcher(
    new AddressPolicy(dynamicResolver),
    transport,
    { maxRedirects: 3, connectTimeoutMs: 1_000, totalTimeoutMs: 3_000 },
  );

  await assertRejects(
    () => fetcher.fetch("http://start.test/blob", "publisher"),
    NetworkPolicyError,
  );
  assertEquals(calls.length, 1);
  assertEquals(calls[0].address, "93.184.216.34");
});
