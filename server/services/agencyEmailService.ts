/**
 * Branded email for agencies (agency phase 3). An agency connects its own email service
 * (Resend, SendGrid or Brevo, by API key) and sender address; login details and password reset
 * emails to its people then go out in its name, with links to its own web address. Nothing is
 * sent for direct customers. Keys are stored encrypted (encryptionService) and never returned.
 */
import type { Agency } from "@shared/schema";
import { agencyEmailView, type PublicBrand } from "@shared/agency";
import { encrypt, safeDecrypt } from "./encryptionService";
import { brandOfAgency } from "./agencyBrandService";

/** Tests point every provider at a local fake server. */
function providerBase(defaultBase: string): string {
  return (process.env.EMAIL_PROVIDER_BASE_URL || defaultBase).replace(/\/+$/, "");
}

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface SendResult {
  ok: boolean;
  error?: string;
}

/** Saves email settings; a new key replaces the old one (empty string removes it, undefined keeps it). */
export function nextEmailSettings(current: unknown, input: Record<string, unknown>): Record<string, unknown> {
  const cur = current && typeof current === "object" ? { ...(current as Record<string, unknown>) } : {};
  const str = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  if (input.provider !== undefined) cur.provider = str(input.provider, 20);
  if (input.fromEmail !== undefined) cur.fromEmail = str(input.fromEmail);
  if (input.fromName !== undefined) cur.fromName = str(input.fromName, 80);
  if (input.replyTo !== undefined) cur.replyTo = str(input.replyTo);
  if (input.welcomeByDefault !== undefined) cur.welcomeByDefault = input.welcomeByDefault !== false;
  if (typeof input.apiKey === "string") {
    const key = input.apiKey.trim();
    if (key) {
      cur.apiKeyEnc = encrypt(key);
      cur.apiKeyLast4 = key.slice(-4);
    } else {
      delete cur.apiKeyEnc;
      delete cur.apiKeyLast4;
    }
  }
  return cur;
}

export async function sendAgencyEmail(agency: Agency, msg: EmailMessage): Promise<SendResult> {
  const view = agencyEmailView(agency.emailSettings);
  if (!view.ready) return { ok: false, error: "Email isn't set up for this agency" };
  const settings = agency.emailSettings as Record<string, unknown>;
  const apiKey = safeDecrypt(String(settings.apiKeyEnc || ""));
  if (!apiKey) return { ok: false, error: "The email API key can't be read. Enter it again." };
  const fromName = view.fromName || brandOfAgency(agency).name;
  try {
    let res: Response;
    if (view.provider === "resend") {
      res = await fetch(`${providerBase("https://api.resend.com")}/emails`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: `${fromName} <${view.fromEmail}>`, to: [msg.to], subject: msg.subject, html: msg.html, text: msg.text,
          ...(view.replyTo ? { reply_to: view.replyTo } : {}),
        }),
      });
    } else if (view.provider === "sendgrid") {
      res = await fetch(`${providerBase("https://api.sendgrid.com")}/v3/mail/send`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: msg.to }] }],
          from: { email: view.fromEmail, name: fromName },
          ...(view.replyTo ? { reply_to: { email: view.replyTo } } : {}),
          subject: msg.subject,
          content: [{ type: "text/plain", value: msg.text }, { type: "text/html", value: msg.html }],
        }),
      });
    } else {
      res = await fetch(`${providerBase("https://api.brevo.com")}/v3/smtp/email`, {
        method: "POST",
        headers: { "api-key": apiKey, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          sender: { email: view.fromEmail, name: fromName }, to: [{ email: msg.to }], subject: msg.subject,
          htmlContent: msg.html, textContent: msg.text, ...(view.replyTo ? { replyTo: { email: view.replyTo } } : {}),
        }),
      });
    }
    if (!res.ok) {
      const body = (await res.text().catch(() => "")).slice(0, 300);
      console.warn(`[AgencyEmail] ${view.provider} refused (${res.status}) for agency ${agency.id}: ${body}`);
      return { ok: false, error: `${view.provider} refused the email (${res.status}). Check the API key and that the sender address is verified there.` };
    }
    return { ok: true };
  } catch (err) {
    console.warn(`[AgencyEmail] send failed for agency ${agency.id}:`, err instanceof Error ? err.message : err);
    return { ok: false, error: "Couldn't reach the email service. Please try again." };
  }
}

// ── messages ─────────────────────────────────────────────────────────────────

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

/** The web address people log in at: the agency's own once connected, else ours. */
export function loginUrlFor(brand: PublicBrand): string {
  return brand.domain ? `https://${brand.domain}` : (process.env.APP_PUBLIC_URL || "https://portal.aichroney.com").replace(/\/+$/, "");
}

function layout(brand: PublicBrand, logoBase: string, title: string, bodyHtml: string): string {
  const color = brand.primaryColor || "#0f766e";
  const logo = brand.logoUrl ? `<img src="${esc(logoBase + brand.logoUrl)}" alt="" width="40" height="40" style="border-radius:8px;vertical-align:middle;margin-right:10px">` : "";
  return `<!doctype html><html><body style="margin:0;background:#f5f5f7;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#111">
<div style="max-width:520px;margin:24px auto;background:#fff;border-radius:16px;padding:28px">
<div style="font-size:18px;font-weight:700;color:${color};margin-bottom:20px">${logo}${esc(brand.name)}</div>
<h1 style="font-size:20px;margin:0 0 12px">${esc(title)}</h1>
${bodyHtml}
${brand.supportEmail ? `<p style="margin-top:24px;font-size:13px;color:#666">Need help? Write to ${esc(brand.supportEmail)}</p>` : ""}
</div></body></html>`;
}

function button(brand: PublicBrand, href: string, label: string): string {
  return `<p style="margin:20px 0"><a href="${esc(href)}" style="background:${brand.primaryColor || "#0f766e"};color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:600;display:inline-block">${esc(label)}</a></p>`;
}

export function loginDetailsEmail(agency: Agency, input: { to: string; tempPassword: string; businessName: string }): EmailMessage {
  const brand = brandOfAgency(agency);
  const url = loginUrlFor(brand);
  const html = layout(brand, url, `Your ${brand.name} login`, `
<p>You now have a login for <b>${esc(input.businessName)}</b>.</p>
<table style="font-size:14px;margin:12px 0"><tr><td style="color:#666;padding-right:12px">Login</td><td><b>${esc(input.to)}</b></td></tr>
<tr><td style="color:#666;padding-right:12px">Temporary password</td><td><b style="font-family:monospace">${esc(input.tempPassword)}</b></td></tr></table>
<p style="font-size:14px">You'll choose your own password when you first log in. The temporary password works for 30 days.</p>
${button(brand, url, "Log in")}`);
  const text = `You now have a ${brand.name} login for ${input.businessName}.\n\nLogin: ${input.to}\nTemporary password: ${input.tempPassword}\n\nLog in at ${url} and choose your own password. The temporary password works for 30 days.${brand.supportEmail ? `\n\nNeed help? ${brand.supportEmail}` : ""}`;
  return { to: input.to, subject: `Your ${brand.name} login`, html, text };
}

export function passwordResetEmail(agency: Agency, input: { to: string; token: string }): EmailMessage {
  const brand = brandOfAgency(agency);
  const base = loginUrlFor(brand);
  const link = `${base}/reset-password?token=${encodeURIComponent(input.token)}`;
  const html = layout(brand, base, "Reset your password", `
<p style="font-size:14px">Someone asked to reset the password for <b>${esc(input.to)}</b>. If it was you, choose a new one below. The link works for one hour.</p>
${button(brand, link, "Choose a new password")}
<p style="font-size:13px;color:#666">If you didn't ask for this, you can ignore this email.</p>`);
  const text = `Reset your ${brand.name} password: ${link}\n\nThe link works for one hour. If you didn't ask for this, ignore this email.`;
  return { to: input.to, subject: `Reset your ${brand.name} password`, html, text };
}

export function testEmail(agency: Agency, to: string): EmailMessage {
  const brand = brandOfAgency(agency);
  const url = loginUrlFor(brand);
  return {
    to,
    subject: `${brand.name}: test email`,
    html: layout(brand, url, "Email is working", `<p style="font-size:14px">Login and password emails to your clients will look like this.</p>${button(brand, url, "Open the portal")}`),
    text: `Email is working. Login and password emails to your clients will come from this address. ${url}`,
  };
}
