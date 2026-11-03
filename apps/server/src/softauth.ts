// Software WebAuthn authenticator for tests: real P-256 keys, real CBOR, real signatures.
import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto";

const b64u = (b: Buffer | Uint8Array) => Buffer.from(b).toString("base64url");
const sha = (b: Buffer | string) => createHash("sha256").update(b).digest();

// Minimal CBOR encoder: uints, negative ints, byte strings, text, maps.
type Cbor = number | string | Buffer | Map<Cbor, Cbor> | { [key: string]: Cbor };
function cbor(v: Cbor): Buffer {
  const head = (major: number, n: number) => {
    if (n < 24) return Buffer.from([(major << 5) | n]);
    if (n < 256) return Buffer.from([(major << 5) | 24, n]);
    return Buffer.from([(major << 5) | 25, n >> 8, n & 255]);
  };
  if (typeof v === "number") return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (typeof v === "string") { const s = Buffer.from(v); return Buffer.concat([head(3, s.length), s]); }
  if (Buffer.isBuffer(v)) return Buffer.concat([head(2, v.length), v]);
  const entries: [Cbor, Cbor][] = v instanceof Map ? [...v.entries()] : Object.entries(v);
  return Buffer.concat([head(5, entries.length), ...entries.flatMap(([k, x]) => [cbor(k), cbor(x)])]);
}

export type AuthOpts = { origin?: string; rpID?: string; uv?: boolean };

export class SoftAuthenticator {
  readonly credId = randomBytes(16);
  private priv: KeyObject;
  private x: Buffer; private y: Buffer;
  counter = 0;
  private readonly rpID: string;
  private readonly origin: string;
  constructor(rpID = "home.test", origin = "https://home.test") {
    this.rpID = rpID; this.origin = origin;
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    this.priv = privateKey;
    const { x, y } = publicKey.export({ format: "jwk" });
    this.x = Buffer.from(x ?? "", "base64url"); this.y = Buffer.from(y ?? "", "base64url");
  }
  get id() { return b64u(this.credId); }

  private flags(uv: boolean, at: boolean) { return 0x01 | (uv ? 0x04 : 0) | (at ? 0x40 : 0); }

  register(challenge: string, o: AuthOpts = {}) {
    const cose = cbor(new Map<Cbor, Cbor>([[1, 2], [3, -7], [-1, 1], [-2, this.x], [-3, this.y]]));
    const len = Buffer.alloc(2); len.writeUInt16BE(this.credId.length);
    const cnt = Buffer.alloc(4); cnt.writeUInt32BE(this.counter);
    const authData = Buffer.concat([sha(o.rpID ?? this.rpID), Buffer.from([this.flags(o.uv ?? true, true)]), cnt, Buffer.alloc(16), len, this.credId, cose]);
    const clientData = JSON.stringify({ type: "webauthn.create", challenge, origin: o.origin ?? this.origin, crossOrigin: false });
    return {
      id: this.id, rawId: this.id, type: "public-key", clientExtensionResults: {},
      response: { clientDataJSON: b64u(Buffer.from(clientData)), attestationObject: b64u(cbor({ fmt: "none", attStmt: {}, authData })), transports: ["internal"] },
    };
  }

  assert(challenge: string, o: AuthOpts & { badSignature?: boolean; counter?: number } = {}) {
    this.counter = o.counter ?? this.counter + 1;
    const cnt = Buffer.alloc(4); cnt.writeUInt32BE(this.counter);
    const authData = Buffer.concat([sha(o.rpID ?? this.rpID), Buffer.from([this.flags(o.uv ?? true, false)]), cnt]);
    const clientData = Buffer.from(JSON.stringify({ type: "webauthn.get", challenge, origin: o.origin ?? this.origin, crossOrigin: false }));
    const signed = sign("sha256", Buffer.concat([authData, sha(clientData)]), this.priv); // DER
    if (o.badSignature) signed[signed.length - 1] = (signed.at(-1) ?? 0) ^ 0xff;
    return {
      id: this.id, rawId: this.id, type: "public-key", clientExtensionResults: {},
      response: { clientDataJSON: b64u(clientData), authenticatorData: b64u(authData), signature: b64u(signed) },
    };
  }
}
