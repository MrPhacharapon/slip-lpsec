import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, createVerify } from "node:crypto";
import { signGoogleSheetsAssertion } from "../src/lib/server/google-sheet-auth.ts";

test("private Sheets JWT carries read-only scope, correct audience and valid RS256 signature", () => {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const email = "fixture-operator@synthetic-project.iam.gserviceaccount.com";
  const jwt = signGoogleSheetsAssertion(email,
    privateKey.export({ type: "pkcs8", format: "pem" }).toString(), 1800000000);
  const [header, body, signature, excess] = jwt.split(".");
  assert.equal(excess, undefined);
  assert.deepEqual(JSON.parse(Buffer.from(header, "base64url").toString()),
    { alg: "RS256", typ: "JWT" });
  const claims = JSON.parse(Buffer.from(body, "base64url").toString());
  assert.deepEqual(claims, {
    iss: email,
    scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
    aud: "https://oauth2.googleapis.com/token",
    iat: 1800000000,
    exp: 1800003600,
  });
  assert.equal(createVerify("RSA-SHA256").update(header + "." + body)
    .verify(publicKey, Buffer.from(signature, "base64url")), true);
});

test("service account JWT refuses invalid source and never prints secret", () => {
  assert.throws(() => signGoogleSheetsAssertion("not-an-email", "x", 1800000000));
  assert.throws(() => signGoogleSheetsAssertion(
    "operator@synthetic-project.iam.gserviceaccount.com", "invalid-pem", 1800000000));
});
