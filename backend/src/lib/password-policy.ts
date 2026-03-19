import { randomInt } from "crypto";

/** Hardcoded fallback constants – used only when the DB is unreachable. */
export const PASSWORD_POLICY = {
  minLength: 15,
  minSpecialChars: 1,
  rememberedCount: 24,
  minAgeDays: 7,
  maxAgeDays: 90,
} as const;

const SPECIAL_CHAR_REGEX = /[^A-Za-z0-9]/g;
const UPPERCASE_REGEX = /[A-Z]/;
const NUMBER_REGEX = /[0-9]/;

export type DynamicPolicy = {
  minPasswordLength: number;
  minSpecialChars: number;
  requireUppercase: boolean;
  requireNumber: boolean;
};

/**
 * Validates a password against the live governance policy.
 * When `policy` is omitted, falls back to hardcoded defaults.
 */
export function validatePasswordPolicy(
  password: string,
  policy?: DynamicPolicy,
): string | null {
  const minLength     = policy?.minPasswordLength ?? PASSWORD_POLICY.minLength;
  const minSpecial    = policy?.minSpecialChars   ?? PASSWORD_POLICY.minSpecialChars;
  const needUppercase = policy?.requireUppercase  ?? true;
  const needNumber    = policy?.requireNumber     ?? true;

  if (!password || password.length < minLength) {
    return `Password must be at least ${minLength} characters`;
  }

  const specialCount = (password.match(SPECIAL_CHAR_REGEX) ?? []).length;
  if (specialCount < minSpecial) {
    return `Password must include at least ${minSpecial} special character${minSpecial !== 1 ? "s" : ""}`;
  }

  if (needUppercase && !UPPERCASE_REGEX.test(password)) {
    return "Password must include at least one uppercase letter";
  }

  if (needNumber && !NUMBER_REGEX.test(password)) {
    return "Password must include at least one numeric character";
  }

  return null;
}

export function generateCompliantPassword(
  length: number = PASSWORD_POLICY.minLength,
): string {
  const alpha   = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz";
  const nums    = "23456789";
  const special = "!@#$%^&*";
  const pool    = alpha + nums;

  const chars: string[] = [];
  for (let i = 0; i < Math.max(length - 1, 14); i++) {
    chars.push(pool[randomInt(pool.length)]);
  }
  chars.push(special[randomInt(special.length)]);

  // Fisher-Yates shuffle
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }

  return chars.join("");
}
