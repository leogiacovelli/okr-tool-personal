/**
 * Email transazionali via Resend. Senza RESEND_API_KEY le email vengono
 * loggate in console (comodo in sviluppo). Un errore di invio non fa MAI
 * fallire l'azione applicativa: le notifiche sono best-effort.
 */

function appUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return `${base.replace(/\/$/, "")}${path}`;
}

function template(heading: string, body: string, ctaLabel: string, ctaUrl: string): string {
  return `<!doctype html>
<html lang="it">
  <body style="margin:0;padding:24px;background:#f4f4f5;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#18181b;">
    <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;border:1px solid #e4e4e7;">
      <p style="margin:0 0 4px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#71717a;">OKR · La Tua Azienda</p>
      <h1 style="margin:0 0 16px;font-size:20px;">${heading}</h1>
      <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#3f3f46;">${body}</p>
      <a href="${ctaUrl}" style="display:inline-block;background:#18181b;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 20px;border-radius:8px;">${ctaLabel}</a>
      <p style="margin:24px 0 0;font-size:12px;color:#a1a1aa;">Email automatica del tool OKR interno. Non rispondere a questo messaggio.</p>
    </div>
  </body>
</html>`;
}

async function send(to: string, subject: string, html: string): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.warn(`[email] RESEND_API_KEY assente — email non inviata. To: ${to} — ${subject}`);
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
    console.error("[email] invio fallito:", err);
  }
}

type Ctx = { memberName: string; periodLabel: string; memberId: string; periodId: string };

/** Membro invia obiettivi → email al manager. */
export async function notifySubmitted(managerEmail: string, ctx: Ctx) {
  await send(
    managerEmail,
    `OKR · ${ctx.memberName} ha inviato gli obiettivi ${ctx.periodLabel}`,
    template(
      "Nuova review da fare",
      `${ctx.memberName} ha inviato il set di obiettivi per <strong>${ctx.periodLabel}</strong>. Puoi approvarli o richiedere modifiche.`,
      "Vai alla review",
      appUrl(`/team/${ctx.memberId}?period=${ctx.periodId}`)
    )
  );
}

/** Manager richiede modifiche → email al membro. */
export async function notifyChangesRequested(memberEmail: string, ctx: Ctx) {
  await send(
    memberEmail,
    `OKR · Feedback ricevuto sui tuoi obiettivi ${ctx.periodLabel}`,
    template(
      "Feedback ricevuto",
      `Il manager ha richiesto delle modifiche ai tuoi obiettivi per <strong>${ctx.periodLabel}</strong>. Leggi i commenti, aggiorna gli obiettivi e reinviali.`,
      "Vedi il feedback",
      appUrl(`/okr/${ctx.periodId}`)
    )
  );
}

/** Manager approva → email al membro. */
export async function notifyApproved(memberEmail: string, ctx: Ctx) {
  await send(
    memberEmail,
    `OKR · Obiettivi ${ctx.periodLabel} approvati`,
    template(
      "Obiettivi approvati 🎉",
      `I tuoi obiettivi per <strong>${ctx.periodLabel}</strong> sono stati approvati. Restano consultabili in sola lettura fino alla valutazione di fine semestre.`,
      "Vedi i tuoi obiettivi",
      appUrl(`/okr/${ctx.periodId}`)
    )
  );
}

/** Manager apre la valutazione → email al membro (extra rispetto alla spec, utile). */
export async function notifyEvaluationOpened(memberEmail: string, ctx: Ctx) {
  await send(
    memberEmail,
    `OKR · Valutazione ${ctx.periodLabel} aperta: proponi i tuoi risultati`,
    template(
      "Fase di valutazione aperta",
      `È il momento di proporre i risultati raggiunti per <strong>${ctx.periodLabel}</strong>: per ogni obiettivo indica il risultato effettivo e la % di raggiungimento (0–120%).`,
      "Proponi i risultati",
      appUrl(`/okr/${ctx.periodId}`)
    )
  );
}

/** Membro propone i risultati finali → email al manager. */
export async function notifyResultsProposed(managerEmail: string, ctx: Ctx) {
  await send(
    managerEmail,
    `OKR · ${ctx.memberName} ha proposto i risultati ${ctx.periodLabel}`,
    template(
      "Valutazione da confermare",
      `${ctx.memberName} ha proposto i risultati di fine semestre per <strong>${ctx.periodLabel}</strong>. Rivedi le % proposte, correggile se serve e conferma la valutazione finale.`,
      "Vai alla valutazione",
      appUrl(`/team/${ctx.memberId}?period=${ctx.periodId}`)
    )
  );
}

/** Manager conferma la valutazione finale → email al membro con il punteggio. */
export async function notifyCompleted(memberEmail: string, ctx: Ctx, score: number) {
  const formatted = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 2 }).format(score);
  await send(
    memberEmail,
    `OKR · Semestre ${ctx.periodLabel} valutato — risultato: ${formatted}%`,
    template(
      "Semestre valutato",
      `La valutazione del semestre <strong>${ctx.periodLabel}</strong> è stata confermata. Il tuo OKR Result complessivo è <strong>${formatted}%</strong>.`,
      "Vedi il dettaglio",
      appUrl(`/okr/${ctx.periodId}`)
    )
  );
}
