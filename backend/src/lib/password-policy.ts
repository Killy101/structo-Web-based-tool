export const PASSWORD_POLICY = {
  minLength: 15,
  minSpecialChars: 1,
  rememberedCount: 24,
  minAgeDays: 7,
  maxAgeDays: 90,
} as const;

const SPECIAL_CHAR_REGEX = /[^A-Za-z0-9]/g;

export function validatePasswordPolicy(password: string): string | null {
  if (!password || password.length < PASSWORD_POLICY.minLength) {
    return `Password must be at least ${PASSWORD_POLICY.minLength} characters`;
  }

  const specialCount = (password.match(SPECIAL_CHAR_REGEX) ?? []).length;
  if (specialCount < PASSWORD_POLICY.minSpecialChars) {
    return `Password must include at least ${PASSWORD_POLICY.minSpecialChars} special character`;
  }

  return null;
}

export function generateCompliantPassword(
  length = PASSWORD_POLICY.minLength,
): string {
  const alpha = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz";
  const nums = "23456789";
  const special = "!@#$%^&*";
  const pool = alpha + nums;

  const chars: string[] = [];
  for (let i = 0; i < Math.max(length - 1, 14); i++) {
    chars.push(pool[Math.floor(Math.random() * pool.length)]);
  }

  chars.push(special[Math.floor(Math.random() * special.length)]);

  // Fisher-Yates shuffle
  for (let i = chars.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }

  return chars.join("");
}
