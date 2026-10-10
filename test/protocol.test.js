import test from "node:test";
import assert from "node:assert/strict";
import { makeJoinPassword, makeSecretToken } from "../src/lib/protocol.js";

test("secret token is deterministic and non-empty", () => {
  assert.equal(makeSecretToken(28670), makeSecretToken(28670));
  assert.ok(makeSecretToken(28670).length > 0);
  assert.notEqual(makeSecretToken(28670), makeSecretToken(28671));
});

test("join password contains token and room id", () => {
  const pass = makeJoinPassword(28670, "M#abc");
  assert.ok(pass.startsWith(makeSecretToken(28670)));
  assert.ok(pass.endsWith("M#abc"));
});
