/**
 * Transactional emails via Resend. Without RESEND_API_KEY, emails are just
 * logged to the console (handy in development). A send failure NEVER makes
 * the application action fail: notifications are best-effort.
 */

function appUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return `${base.replace(/\/$/, "")}${path}`;
}

function template(heading: string, body: string, ctaLabel: string, ctaUrl: string): string {
  return `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:24px;background:#f4f4f5;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#18181b;">
    <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;border:1px solid #e4e4e7;">
      <p style="margin:0 0 4px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#71717a;">OKR · Your Company</p>
      <h1 style="margin:0 0 16px;font-size:20px;">${heading}</h1>
      <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#3f3f46;">${body}</p>
      <a href="${ctaUrl}" style="display:inline-block;background:#18181b;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 20px;border-radius:8px;">${ctaLabel}</a>
      <p style="margin:24px 0 0;font-size:12px;color:#a1a1aa;">Automated email from the internal OKR tool. Do not reply to this message.</p>
    </div>
  </body>
</html>`;
}

async function send(to: string, subject: string, html: string): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.warn(`[email] RESEND_API_KEY missing — email not sent. To: ${to} — ${subject}`);
    return;
  }
  try {
    const { Resend } = await import("resend");
    const resend = new Resend(key);
    await resend.emails.send({
      from: process.env.EMAIL_FROM ?? "OKR Tool <onboarding@resend.dev>",
      to,
      subject,
      html,
    });
  } catch (err) {
    console.error("[email] send failed:", err);
  }
}

type Ctx = { memberName: string; periodLabel: string; memberId: string; periodId: string };

/** Member submits objectives → email to the manager. */
export async function notifySubmitted(managerEmail: string, ctx: Ctx) {
  await send(
    managerEmail,
    `OKR · ${ctx.memberName} submitted their ${ctx.periodLabel} objectives`,
    template(
      "New review to do",
      `${ctx.memberName} submitted their objective set for <strong>${ctx.periodLabel}</strong>. You can approve it or request changes.`,
      "Go to review",
      appUrl(`/team/${ctx.memberId}?period=${ctx.periodId}`)
    )
  );
}

/** Manager requests changes → email to the member. */
export async function notifyChangesRequested(memberEmail: string, ctx: Ctx) {
  await send(
    memberEmail,
    `OKR · Feedback received on your ${ctx.periodLabel} objectives`,
    template(
      "Feedback received",
      `Your manager requested changes to your objectives for <strong>${ctx.periodLabel}</strong>. Read the comments, update your objectives, and resubmit them.`,
      "See the feedback",
      appUrl(`/okr/${ctx.periodId}`)
    )
  );
}

/** Manager approves → email to the member. */
export async function notifyApproved(memberEmail: string, ctx: Ctx) {
  await send(
    memberEmail,
    `OKR · ${ctx.periodLabel} objectives approved`,
    template(
      "Objectives approved 🎉",
      `Your objectives for <strong>${ctx.periodLabel}</strong> have been approved. They remain read-only until the end-of-semester evaluation.`,
      "See your objectives",
      appUrl(`/okr/${ctx.periodId}`)
    )
  );
}

/** Manager opens the evaluation → email to the member (extra vs. spec, useful). */
export async function notifyEvaluationOpened(memberEmail: string, ctx: Ctx) {
  await send(
    memberEmail,
    `OKR · ${ctx.periodLabel} evaluation open: propose your results`,
    template(
      "Evaluation phase open",
      `It's time to propose the results you achieved for <strong>${ctx.periodLabel}</strong>: for each objective, enter the actual result and the % achieved (0–120%).`,
      "Propose results",
      appUrl(`/okr/${ctx.periodId}`)
    )
  );
}

/** Member proposes final results → email to the manager. */
export async function notifyResultsProposed(managerEmail: string, ctx: Ctx) {
  await send(
    managerEmail,
    `OKR · ${ctx.memberName} proposed ${ctx.periodLabel} results`,
    template(
      "Evaluation to confirm",
      `${ctx.memberName} proposed their end-of-semester results for <strong>${ctx.periodLabel}</strong>. Review the proposed %, correct them if needed, and confirm the final evaluation.`,
      "Go to evaluation",
      appUrl(`/team/${ctx.memberId}?period=${ctx.periodId}`)
    )
  );
}

/** Manager confirms the final evaluation → email to the member with the score. */
export async function notifyCompleted(memberEmail: string, ctx: Ctx, score: number) {
  const formatted = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(score);
  await send(
    memberEmail,
    `OKR · ${ctx.periodLabel} semester evaluated — result: ${formatted}%`,
    template(
      "Semester evaluated",
      `The evaluation for the <strong>${ctx.periodLabel}</strong> semester has been confirmed. Your overall OKR Result is <strong>${formatted}%</strong>.`,
      "See the details",
      appUrl(`/okr/${ctx.periodId}`)
    )
  );
}
