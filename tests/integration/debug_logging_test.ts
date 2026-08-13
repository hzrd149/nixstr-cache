import { assertEquals } from "@std/assert";
import {
  debugEndpoint,
  debugHttpRequest,
  debugPath,
  inboundRequestId,
  outboundRequestId,
} from "../../src/operations/debug.ts";

Deno.test("HTTP debug fields redact URL secrets and hostile path bytes", () => {
  assertEquals(
    debugEndpoint(
      "https://user:password@example.test/base?token=secret#hidden",
    ),
    "https://example.test/base",
  );
  assertEquals(debugEndpoint("file:///secret"), "invalid");
  assertEquals(debugPath("/nar/a.nar?token=secret#hidden"), "/nar/a.nar");
  assertEquals(debugPath("/nar/control\nvalue"), "/nar/control?value");
});

Deno.test("HTTP debug facade emits compact strings instead of objects", () => {
  const original = console.debug;
  const calls: unknown[][] = [];
  console.debug = (...args: unknown[]) => calls.push(args);
  try {
    debugHttpRequest.enabled = true;
    debugHttpRequest("completed", {
      direction: "inbound",
      inboundId: 7,
      listener: "http://127.0.0.1:8787/",
      method: "GET",
      path: "/nar/demo.nar",
      status: 200,
    });
  } finally {
    debugHttpRequest.enabled = false;
    console.debug = original;
  }
  assertEquals(calls.length, 1);
  assertEquals(calls[0].length, 1);
  assertEquals(
    calls[0][0],
    "nixstr:http:request completed direction=inbound inboundId=7 listener=http://127.0.0.1:8787/ method=GET path=/nar/demo.nar status=200",
  );
});

Deno.test("HTTP debug correlation identifiers are positive and distinct", () => {
  const first = inboundRequestId();
  const second = inboundRequestId();
  const outbound = outboundRequestId();
  assertEquals(first > 0, true);
  assertEquals(second > 0, true);
  assertEquals(first === second, false);
  assertEquals(outbound, 1);
});
