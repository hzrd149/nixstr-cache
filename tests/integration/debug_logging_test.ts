import { assertEquals } from "@std/assert";
import {
  debugEndpoint,
  debugHttpRequest,
  debugPath,
  requestId,
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
      requestId: 7,
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
    "nixstr:http:request completed requestId=7 method=GET path=/nar/demo.nar status=200",
  );
});

Deno.test("HTTP debug correlation identifiers are positive and distinct", () => {
  const first = requestId();
  const second = requestId();
  assertEquals(first > 0, true);
  assertEquals(second > 0, true);
  assertEquals(first === second, false);
});
