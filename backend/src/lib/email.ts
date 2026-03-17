import { Resend } from "resend";

type SendPasswordEmailInput = {
  to: string;
  userId: string;
  fullName?: string;
  password: string;
  action: "created" | "reset";
};

function buildSubject(action: "created" | "reset"): string {
  return action === "created"
    ? "Your Structo account has been created"
    : "Your Structo password has been reset";
}

function buildHtml({ userId, fullName, password, action }: SendPasswordEmailInput): string {
  const greeting = fullName?.trim() ? `Hi ${fullName.trim()},` : "Hi,";
  const intro =
    action === "created"
      ? "Your account was created. Use the credentials below to sign in."
      : "Your password was reset. Use the temporary credentials below to sign in.";

  return `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#0f172a;max-width:560px;margin:0 auto;padding:24px;">
      <h2 style="margin:0 0 12px;">Structo Credentials</h2>
      <p style="margin:0 0 12px;">${greeting}</p>
      <p style="margin:0 0 16px;">${intro}</p>
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px 14px;margin-bottom:16px;">
        <p style="margin:0;"><strong>User ID:</strong> ${userId}</p>
        <p style="margin:8px 0 0;"><strong>Password:</strong> ${password}</p>
      </div>
      <p style="margin:0 0 8px;">Please change your password after login.</p>
      <p style="margin:0;color:#64748b;font-size:12px;">If you did not expect this message, contact your administrator.</p>
    </div>
  `;
}

export async function sendPasswordEmail(input: SendPasswordEmailInput): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) return false;

  const from = process.env.RESEND_FROM_EMAIL?.trim() || "Structo <onboarding@resend.dev>";

  try {
    const resend = new Resend(apiKey);
    await resend.emails.send({
      from,
      to: input.to,
      subject: buildSubject(input.action),
      html: buildHtml(input),
    });
    return true;
  } catch (error) {
    console.error("[email] Failed to send password email:", error);
    return false;
  }
}
