import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  encryptSecret,
  decryptSecret,
  currentKeyVersion,
  needsRotation,
  secretsMatch,
  SecretBoxError,
} from "./secret-box";

/**
 * These guard the only thing standing between a merchant's PayFast key and
 * anyone with read access to the database. The tamper cases matter as much as
 * the round-trip: silently decrypting a modified ciphertext to plausible
 * rubbish would mean signing a payment with a corrupted merchant key rather
 * than failing, and the failure would surface as an inscrutable gateway error
 * rather than as "this value was altered".
 */

const KEY_ENVS = [
  "PAYMENT_ENCRYPTION_KEY",
  "PAYMENT_ENCRYPTION_KEY_V2",
  "PAYMENT_ENCRYPTION_KEY_V3",
] as const;

function key(): string {
  return randomBytes(32).toString("base64");
}

/** Runs `fn` with exactly the given key env vars set, restoring afterwards. */
function withKeys(keys: Partial<Record<(typeof KEY_ENVS)[number], string>>, fn: () => void) {
  const env = process.env as Record<string, string | undefined>;
  const saved = Object.fromEntries(KEY_ENVS.map((k) => [k, env[k]]));
  try {
    for (const k of KEY_ENVS) {
      if (keys[k] === undefined) delete env[k];
      else env[k] = keys[k];
    }
    fn();
  } finally {
    for (const k of KEY_ENVS) {
      if (saved[k] === undefined) delete env[k];
      else env[k] = saved[k];
    }
  }
}

// --- round trip -------------------------------------------------------------

test("a secret survives a round trip unchanged", () => {
  withKeys({ PAYMENT_ENCRYPTION_KEY: key() }, () => {
    const secret = "46f0cd694581a";
    const sealed = encryptSecret(secret);
    assert.equal(decryptSecret(sealed.payload), secret);
  });
});

test("the sealed payload never contains the plaintext", () => {
  withKeys({ PAYMENT_ENCRYPTION_KEY: key() }, () => {
    const secret = "my-passphrase-2026";
    const sealed = encryptSecret(secret);
    assert.ok(!sealed.payload.includes(secret), "plaintext must not appear in the payload");
  });
});

test("unicode and long passphrases survive", () => {
  withKeys({ PAYMENT_ENCRYPTION_KEY: key() }, () => {
    const secret = "pass — phrase — ümlaut — 🔐 ".repeat(20);
    assert.equal(decryptSecret(encryptSecret(secret).payload), secret);
  });
});

test("encrypting the same secret twice gives different ciphertext", () => {
  // A fresh IV per call. Without it, identical merchant keys across businesses
  // would be visibly identical in the database.
  withKeys({ PAYMENT_ENCRYPTION_KEY: key() }, () => {
    const a = encryptSecret("same-secret").payload;
    const b = encryptSecret("same-secret").payload;
    assert.notEqual(a, b);
    assert.equal(decryptSecret(a), decryptSecret(b));
  });
});

// --- tamper detection -------------------------------------------------------

test("a flipped byte in the ciphertext is rejected, not silently decrypted", () => {
  withKeys({ PAYMENT_ENCRYPTION_KEY: key() }, () => {
    const sealed = encryptSecret("merchant-key-value");
    const [v, iv, tag, ct] = sealed.payload.split(".");
    const bytes = Buffer.from(ct, "base64");
    bytes[0] ^= 0xff;
    const tampered = [v, iv, tag, bytes.toString("base64")].join(".");
    assert.throws(() => decryptSecret(tampered), SecretBoxError);
  });
});

test("a tampered authentication tag is rejected", () => {
  withKeys({ PAYMENT_ENCRYPTION_KEY: key() }, () => {
    const sealed = encryptSecret("merchant-key-value");
    const [v, iv, tag, ct] = sealed.payload.split(".");
    const bytes = Buffer.from(tag, "base64");
    bytes[0] ^= 0xff;
    assert.throws(() => decryptSecret([v, iv, bytes.toString("base64"), ct].join(".")), SecretBoxError);
  });
});

test("a swapped IV is rejected", () => {
  withKeys({ PAYMENT_ENCRYPTION_KEY: key() }, () => {
    const a = encryptSecret("secret-a").payload.split(".");
    const b = encryptSecret("secret-b").payload.split(".");
    assert.throws(() => decryptSecret([a[0], b[1], a[2], a[3]].join(".")), SecretBoxError);
  });
});

test("malformed payloads are rejected rather than throwing something unhelpful", () => {
  withKeys({ PAYMENT_ENCRYPTION_KEY: key() }, () => {
    for (const bad of ["", "nonsense", "v1.only.three", "x1.a.b.c", "v1.a.b.c.d"]) {
      assert.throws(() => decryptSecret(bad), SecretBoxError, `should reject: ${JSON.stringify(bad)}`);
    }
  });
});

// --- key handling -----------------------------------------------------------

test("a different key cannot decrypt — and fails closed", () => {
  let payload = "";
  withKeys({ PAYMENT_ENCRYPTION_KEY: key() }, () => {
    payload = encryptSecret("merchant-key-value").payload;
  });
  withKeys({ PAYMENT_ENCRYPTION_KEY: key() }, () => {
    assert.throws(() => decryptSecret(payload), SecretBoxError);
  });
});

test("no key configured throws instead of falling back to something predictable", () => {
  withKeys({}, () => {
    assert.throws(() => encryptSecret("anything"), SecretBoxError);
    assert.throws(() => currentKeyVersion(), SecretBoxError);
  });
});

test("a key of the wrong length is refused", () => {
  withKeys({ PAYMENT_ENCRYPTION_KEY: randomBytes(16).toString("base64") }, () => {
    assert.throws(() => encryptSecret("anything"), /32 bytes/);
  });
});

test("refuses to encrypt an empty secret", () => {
  withKeys({ PAYMENT_ENCRYPTION_KEY: key() }, () => {
    assert.throws(() => encryptSecret(""), SecretBoxError);
  });
});

// --- rotation ---------------------------------------------------------------

test("new writes use the highest configured key version", () => {
  withKeys({ PAYMENT_ENCRYPTION_KEY: key(), PAYMENT_ENCRYPTION_KEY_V2: key() }, () => {
    assert.equal(currentKeyVersion(), 2);
    const sealed = encryptSecret("written-after-rotation");
    assert.equal(sealed.keyVersion, 2);
    assert.ok(sealed.payload.startsWith("v2."));
  });
});

test("values written before a rotation still decrypt afterwards", () => {
  // The whole point of rotation support: adding a new key must not strand
  // every merchant connection already stored under the old one.
  const k1 = key();
  let old = "";
  withKeys({ PAYMENT_ENCRYPTION_KEY: k1 }, () => {
    old = encryptSecret("written-before-rotation").payload;
  });
  withKeys({ PAYMENT_ENCRYPTION_KEY: k1, PAYMENT_ENCRYPTION_KEY_V2: key() }, () => {
    assert.equal(currentKeyVersion(), 2);
    assert.equal(decryptSecret(old), "written-before-rotation", "old rows must still decrypt");
    assert.equal(needsRotation(1), true, "a v1 row should be flagged for re-encryption");
    assert.equal(needsRotation(2), false);
  });
});

test("removing the old key strands its rows with a clear error, not a silent wrong answer", () => {
  const k1 = key();
  let old = "";
  withKeys({ PAYMENT_ENCRYPTION_KEY: k1 }, () => {
    old = encryptSecret("written-under-v1").payload;
  });
  withKeys({ PAYMENT_ENCRYPTION_KEY_V2: key() }, () => {
    assert.throws(() => decryptSecret(old), /PAYMENT_ENCRYPTION_KEY is not set/);
  });
});

// --- constant-time compare --------------------------------------------------

test("secretsMatch compares by value and tolerates differing lengths", () => {
  assert.equal(secretsMatch("abc123", "abc123"), true);
  assert.equal(secretsMatch("abc123", "abc124"), false);
  assert.equal(secretsMatch("abc", "abc123"), false);
  assert.equal(secretsMatch("", ""), true);
});
