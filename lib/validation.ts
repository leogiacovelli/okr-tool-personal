import { z } from "zod";

/**
 * Validazione lato server (le server action la applicano SEMPRE, oltre alla
 * validazione client dei form). I vincoli critici — somma pesi = 100 al
 * submit, punteggi 0–120 — sono comunque applicati anche dal database.
 */

export const objectiveInput = z.object({
  objective: z.string().trim().min(1, "Il titolo dell'obiettivo è obbligatorio").max(300),
  key_result: z.string().trim().min(1, "Il Key Result è obbligatorio").max(300),
  smart_requirements: z.string().trim().max(5000).default(""),
  starting_point: z.string().trim().max(500).default(""),
  target_outcome: z.string().trim().max(500).default(""),
  metric_type: z.string().trim().max(100).default(""),
  weight: z.coerce
    .number({ invalid_type_error: "Il peso deve essere un numero" })
    .gt(0, "Ogni peso deve essere maggiore di 0")
    .lte(100, "Ogni peso deve essere al massimo 100"),
});

export const objectivesPayload = z
  .array(objectiveInput)
  .min(1, "Aggiungi almeno un obiettivo")
  .max(20, "Massimo 20 obiettivi per semestre");

export const proposalInput = z.object({
  id: z.string().uuid(),
  result_value: z.string().trim().min(1, "Indica il risultato raggiunto").max(500),
  result_note: z.string().trim().max(2000).default(""),
  proposed_score: z.coerce
    .number({ invalid_type_error: "La % deve essere un numero" })
    .min(0, "La % non può essere negativa")
    .max(120, "La % massima è 120"),
});

export const proposalsPayload = z.array(proposalInput).min(1);

export const finalScoreInput = z.object({
  id: z.string().uuid(),
  result_value: z.string().trim().min(1, "Indica il risultato").max(500),
  result_note: z.string().trim().max(2000).default(""),
  final_score: z.coerce
    .number({ invalid_type_error: "La % deve essere un numero" })
    .min(0, "La % non può essere negativa")
    .max(120, "La % massima è 120"),
});

export const finalScoresPayload = z.array(finalScoreInput).min(1);

export const periodInput = z
  .object({
    label: z.string().trim().min(1, "Etichetta obbligatoria (es. H1 2026)").max(50),
    starts_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data di inizio non valida"),
    ends_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data di fine non valida"),
  })
  .refine((p) => p.starts_on < p.ends_on, {
    message: "La data di inizio deve precedere quella di fine",
  });

export const inviteInput = z.object({
  email: z.string().trim().email("Email non valida"),
  full_name: z.string().trim().min(1, "Nome obbligatorio").max(200),
});

export const teamInput = z.object({
  name: z.string().trim().min(1, "Nome del team obbligatorio").max(100),
  manager_id: z.string().uuid().nullable(),
  parent_team_id: z.string().uuid().nullable(),
});

/**
 * Requisiti password, allineati alle policy impostate su Supabase Auth
 * (minimo 12 caratteri + lettere, numeri e simboli; Supabase rifiuta inoltre
 * le password compromesse note). Qui servono a dare un messaggio d'errore
 * chiaro PRIMA della chiamata: la regola vera resta quella del server.
 */
export const PASSWORD_MIN_LENGTH = 12;

export function passwordError(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `La password deve avere almeno ${PASSWORD_MIN_LENGTH} caratteri.`;
  }
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    return "La password deve contenere lettere e numeri.";
  }
  if (!/[^a-zA-Z0-9]/.test(password)) {
    return "La password deve contenere almeno un simbolo (es. ! ? # @).";
  }
  return null;
}
