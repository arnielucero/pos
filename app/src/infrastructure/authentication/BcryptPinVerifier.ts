import bcrypt from 'bcryptjs';
import type { PinVerifier } from '../../application/ports/Credentials';

/**
 * Verifies manager PINs against the synced bcrypt hash ($2y$/$2b$/$2a$, cost ≥ 12).
 * Argon2id hashes ("$argon2id$…") are not verifiable in the WebView without a native/WASM
 * argon2 implementation and are reported as unsupported (see contract deviations).
 */
export class BcryptPinVerifier implements PinVerifier {
  supports(hash: string): boolean {
    return /^\$2[aby]\$\d{2}\$/.test(hash);
  }

  async verify(pin: string, hash: string): Promise<boolean> {
    if (!this.supports(hash)) return false;
    try {
      return await bcrypt.compare(pin, hash);
    } catch {
      return false;
    }
  }
}
