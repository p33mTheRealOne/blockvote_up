/**
 * Thai national ID card number utilities.
 * Ported from the Python reference (parser.py + thai_id.py) into
 * TypeScript so OCR + validation both run client-side in the browser,
 * with no Python backend required.
 */

// Same extraction strategy as parser.py's extract_citizen_id: find
// runs of digits/spaces long enough to contain a 13-digit ID, then
// strip non-digits and keep the first run that's exactly 13 long.
const CANDIDATE_PATTERN = /[0-9 \-]{13,20}/g;

export function extractCitizenId(rawText: string): string | null {
  const candidates = rawText.match(CANDIDATE_PATTERN);
  if (!candidates) return null;

  for (const candidate of candidates) {
    const digitsOnly = candidate.replace(/\D/g, "");
    if (digitsOnly.length === 13) {
      return digitsOnly;
    }
  }

  return null;
}

/**
 * Thai national ID checksum (mod-11), ported directly from thai_id.py.
 * The 13th digit is a check digit computed from the first 12:
 *   check = (11 - (sum(digit[i] * (13 - i) for i in 0..11) % 11)) % 10
 */
export function validateCitizenId(rawId: string): boolean {
  const cid = rawId.replace(/\D/g, "");
  if (cid.length !== 13) return false;

  let total = 0;
  for (let i = 0; i < 12; i++) {
    total += Number(cid[i]) * (13 - i);
  }

  const check = (11 - (total % 11)) % 10;
  return check === Number(cid[12]);
}

/**
 * Combined extract + validate: only returns an ID that is both
 * 13 digits AND passes the checksum. This is a much stronger signal
 * than length alone, so the scanner can trust a single good read
 * instead of needing several repeated OCR passes.
 */
export function extractValidCitizenId(rawText: string): string | null {
  const candidates = rawText.match(CANDIDATE_PATTERN);
  if (!candidates) return null;

  for (const candidate of candidates) {
    const digitsOnly = candidate.replace(/\D/g, "");
    if (digitsOnly.length === 13 && validateCitizenId(digitsOnly)) {
      return digitsOnly;
    }
  }

  return null;
}