import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify, type KeyObject } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export interface Signer {
  readonly keyId: string;
  sign(bytes: Uint8Array): Promise<{ signature: string; keyId: string }>;
  verify(bytes: Uint8Array, signature: string, keyId: string): Promise<boolean>;
}

/** Ed25519 key pair kept in .data/keys (generated on first use). KMS signer comes after the demo. */
export class LocalEd25519Signer implements Signer {
  readonly keyId = "local-ed25519-1";
  private priv: KeyObject;
  private pub: KeyObject;

  constructor(dir = process.env.KEY_DIR ?? ".data/keys") {
    const privPath = join(dir, `${this.keyId}.pem`);
    if (!existsSync(privPath)) {
      mkdirSync(dir, { recursive: true });
      const { privateKey } = generateKeyPairSync("ed25519");
      writeFileSync(privPath, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
    }
    this.priv = createPrivateKey(readFileSync(privPath));
    this.pub = createPublicKey(this.priv);
  }

  async sign(bytes: Uint8Array) {
    return { signature: sign(null, bytes, this.priv).toString("base64"), keyId: this.keyId };
  }

  async verify(bytes: Uint8Array, signature: string, keyId: string) {
    if (keyId !== this.keyId) return false;
    return verify(null, bytes, this.pub, Buffer.from(signature, "base64"));
  }

  publicKeyPem(): string {
    return this.pub.export({ type: "spki", format: "pem" }).toString();
  }
}
