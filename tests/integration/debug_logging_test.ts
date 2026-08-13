import { assertEquals } from "@std/assert";
import {
  debugCacheState,
  debugEndpoint,
  debugHttpRequest,
  debugPath,
  debugWriteHashtreeState,
  inboundRequestId,
  outboundRequestId,
} from "../../src/operations/debug.ts";

const NHASH_A =
  "nhash1qqsg2g2kl6dmsqxmgfgwrnpq794qd0h2zcn4r4q4qcvn9jcq0m7792cf2764x";
const NHASH_B =
  "nhash1qqs9z6rzcqs82lfrzgrwckty9hapjruvms3pnarkr75t7vfj6xynhqs9zzcqs";

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

Deno.test("cache state debug emits one ordered compact nhash snapshot", () => {
  const original = console.debug;
  const calls: unknown[][] = [];
  console.debug = (...args: unknown[]) => calls.push(args);
  try {
    debugCacheState.enabled = true;
    debugCacheState("selected", {
      count: 2,
      caches: [
        `17091:${"a".repeat(64)}:@${NHASH_A}`,
        `37091:${"b".repeat(64)}:named@${NHASH_B}`,
      ],
    });
  } finally {
    debugCacheState.enabled = false;
    console.debug = original;
  }
  assertEquals(calls, [[
    `nixstr:cache:state selected count=2 caches=17091:${
      "a".repeat(64)
    }:@${NHASH_A},37091:${"b".repeat(64)}:named@${NHASH_B}`,
  ]]);
  const output = String(calls[0][0]);
  assertEquals(/[{}]/.test(output), false);
  assertEquals(
    /\b[0-9a-f]{64}\b/.test(output.replaceAll(/:[0-9a-f]{64}:/g, "::")),
    false,
  );
});

Deno.test("write Hashtree debug emits stable scalar candidate fields", () => {
  const original = console.debug;
  const calls: unknown[][] = [];
  console.debug = (...args: unknown[]) => calls.push(args);
  try {
    debugWriteHashtreeState.enabled = true;
    debugWriteHashtreeState("pending", {
      generation: 8,
      batchId: 3,
      root: NHASH_A,
      blobCount: 4,
      totalBytes: 1024,
    });
  } finally {
    debugWriteHashtreeState.enabled = false;
    console.debug = original;
  }
  assertEquals(calls, [[
    `nixstr:write:hashtree pending generation=8 batchId=3 root=${NHASH_A} blobCount=4 totalBytes=1024`,
  ]]);
  const output = String(calls[0][0]);
  assertEquals(/[{}]/.test(output), false);
  assertEquals(/\b[0-9a-f]{64}\b/.test(output), false);
});
