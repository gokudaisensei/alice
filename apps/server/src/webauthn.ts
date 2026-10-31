import {
  generateAuthenticationOptions, generateRegistrationOptions,
  verifyAuthenticationResponse, verifyRegistrationResponse,
} from "@simplewebauthn/server";

export type StoredCredential = { credentialId: string; publicKey: string; counter: number; transports: string[] };

// Interface so tests can substitute a fake authenticator.
export interface WebAuthnService {
  regOptions(user: { id: string; name: string }, exclude: string[], opts?: { hardwareKey?: boolean }): Promise<{ options: any; challenge: string }>;
  regVerify(response: any, challenge: string): Promise<StoredCredential | null>;
  authOptions(): Promise<{ options: any; challenge: string }>;
  authVerify(response: any, challenge: string, cred: StoredCredential): Promise<number | null>; // new counter
}

const b64 = {
  enc: (u: Uint8Array) => Buffer.from(u).toString("base64url"),
  dec: (s: string) => new Uint8Array(Buffer.from(s, "base64url")),
};

export function realWebAuthn(opts: { rpID: string; rpName: string; origin: string }): WebAuthnService {
  return {
    async regOptions(user, exclude, o) {
      const options = await generateRegistrationOptions({
        rpName: opts.rpName, rpID: opts.rpID, userName: user.name,
        userID: new TextEncoder().encode(user.id), attestationType: "none",
        excludeCredentials: exclude.map((id) => ({ id })),
        // Company staff must use a roaming (hardware) key; browsers honour this, but without attestation we cannot prove it.
        authenticatorSelection: { residentKey: "required", userVerification: "required", ...(o?.hardwareKey ? { authenticatorAttachment: "cross-platform" as const } : {}) },
      });
      return { options, challenge: options.challenge };
    },
    async regVerify(response, challenge) {
      try {
        const v = await verifyRegistrationResponse({
          response, expectedChallenge: challenge, expectedOrigin: opts.origin,
          expectedRPID: opts.rpID, requireUserVerification: true,
        });
        if (!v.verified) return null;
        const c = v.registrationInfo.credential;
        return { credentialId: c.id, publicKey: b64.enc(c.publicKey), counter: c.counter, transports: (c.transports ?? []) as string[] };
      } catch { return null; }
    },
    async authOptions() {
      const options = await generateAuthenticationOptions({ rpID: opts.rpID, userVerification: "required" });
      return { options, challenge: options.challenge };
    },
    async authVerify(response, challenge, cred) {
      try {
        const v = await verifyAuthenticationResponse({
          response, expectedChallenge: challenge, expectedOrigin: opts.origin, expectedRPID: opts.rpID,
          requireUserVerification: true,
          credential: { id: cred.credentialId, publicKey: b64.dec(cred.publicKey), counter: cred.counter, transports: cred.transports as any },
        });
        return v.verified ? v.authenticationInfo.newCounter : null;
      } catch { return null; }
    },
  };
}
