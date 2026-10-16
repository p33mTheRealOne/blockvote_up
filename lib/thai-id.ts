/**
 * Validate Thai National ID checksum.
 */
export function isValidThaiCitizenId(
  id: string
): boolean {
  const clean = id.replace(/\D/g, "");

  if (clean.length !== 13) {
    return false;
  }

  // Reject IDs consisting of the same digit.
  if (/^(\d)\1{12}$/.test(clean)) {
    return false;
  }

  let sum = 0;

  for (let i = 0; i < 12; i++) {
    const digit = Number(clean[i]);
    const weight = 13 - i;

    sum += digit * weight;
  }

  const checkDigit =
    (11 - (sum % 11)) % 10;

  return (
    checkDigit === Number(clean[12])
  );
}

function normalizeOcrText(
  text: string
): string {
  return text
    .replace(/[^\d\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extract a valid 13-digit Thai National ID
 * from OCR text.
 */
export function extractValidCitizenId(
  text: string
): string | null {
  if (!text) {
    return null;
  }

  const normalized =
    normalizeOcrText(text);

  // Try continuous 13 digits first.
  const continuousMatches =
    normalized.match(/\d{13}/g) ?? [];

  for (const candidate of continuousMatches) {
    if (
      isValidThaiCitizenId(candidate)
    ) {
      return candidate;
    }
  }

  // Remove separators and search every
  // possible 13-digit window.
  const digits =
    normalized.replace(/\D/g, "");

  if (digits.length >= 13) {
    for (
      let i = 0;
      i <= digits.length - 13;
      i++
    ) {
      const candidate =
        digits.slice(i, i + 13);

      if (
        isValidThaiCitizenId(candidate)
      ) {
        return candidate;
      }
    }
  }

  // Try common grouped OCR format.
  const groupedMatches =
    normalized.match(
      /\d{1,2}[-\s]\d{3,5}[-\s]\d{4,6}[-\s]\d{1,3}[-\s]\d{1,2}/g
    );

  if (groupedMatches) {
    for (const match of groupedMatches) {
      const candidate =
        match.replace(/\D/g, "");

      if (
        candidate.length === 13 &&
        isValidThaiCitizenId(candidate)
      ) {
        return candidate;
      }
    }
  }

  return null;
}

/**
 * Server-side validation.
 *
 * Returns the normalized 13-digit ID when valid.
 * Throws when invalid.
 */
export function validateCitizenId(
  id: string
): string {
  const clean = id.replace(/\D/g, "");

  if (clean.length !== 13) {
    throw new Error(
      "Thai National ID must contain exactly 13 digits"
    );
  }

  if (!isValidThaiCitizenId(clean)) {
    throw new Error(
      "Invalid Thai National ID checksum"
    );
  }

  return clean;
}