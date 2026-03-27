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
    ? "Your IDAF account has been created"
    : "Your IDAF password has been reset";
}

function buildHtml({ userId, fullName, password, action }: SendPasswordEmailInput): string {
  const greeting = fullName?.trim() ? `Hi ${fullName.trim()},` : "Hi,";
  const intro =
    action === "created"
      ? "Your account was created. Use the credentials below to sign in."
      : "Your password was reset. Use the temporary credentials below to sign in.";

  return `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#0f172a;max-width:560px;margin:0 auto;padding:24px;">
      <h2 style="margin:0 0 12px;">IDAF Credentials</h2>
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

export async function sendPasswordEmail(input: SendPasswordEmailInput): Promise<{ success: boolean; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    const errorMsg = "RESEND_API_KEY not configured in environment";
    console.error("[email]", errorMsg);
    return { success: false, error: errorMsg };
  }

  const from = process.env.RESEND_FROM_EMAIL?.trim() || "IDAF <onboarding@resend.dev>";

  try {
    const resend = new Resend(apiKey);
    const result = await resend.emails.send({
      from,
      to: input.to,
      subject: buildSubject(input.action),
      html: buildHtml(input),
    });
    
    if (result.error) {
      const errorMsg = `Resend error: ${result.error.message || JSON.stringify(result.error)}`;
      console.error("[email] Failed to send password email:", errorMsg);
      return { success: false, error: errorMsg };
    }
    
    console.log(`[email] Successfully sent ${input.action} email to ${input.to}`);
    return { success: true };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("[email] Exception while sending password email:", errorMsg);
    return { success: false, error: errorMsg };
  }
}
