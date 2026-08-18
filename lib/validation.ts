import { z } from "zod";

/**
 * Server-side validation (server actions ALWAYS apply it, on top of the
 * client-side form validation). The critical constraints — weights sum to
 * 100 on submit, scores 0–120 — are enforced by the database as well.
 */

export const objectiveInput = z.object({
  objective: z.string().trim().min(1, "The objective title is required").max(300),
  key_result: z.string().trim().min(1, "The Key Result is required").max(300),
  smart_requirements: z.string().trim().max(5000).default(""),
  starting_point: z.string().trim().max(500).default(""),
  target_outcome: z.string().trim().max(500).default(""),
  metric_type: z.string().trim().max(100).default(""),
  weight: z.coerce
    .number({ invalid_type_error: "The weight must be a number" })
    .gt(0, "Each weight must be greater than 0")
    .lte(100, "Each weight must be at most 100"),
});

export const objectivesPayload = z
  .array(objectiveInput)
  .min(1, "Add at least one objective")
  .max(20, "Maximum 20 objectives per semester");

export const proposalInput = z.object({
  id: z.string().uuid(),
  result_value: z.string().trim().min(1, "State the result achieved").max(500),
  result_note: z.string().trim().max(2000).default(""),
  proposed_score: z.coerce
    .number({ invalid_type_error: "The % must be a number" })
    .min(0, "The % cannot be negative")
    .max(120, "The maximum % is 120"),
});

export const proposalsPayload = z.array(proposalInput).min(1);

export const finalScoreInput = z.object({
  id: z.string().uuid(),
  result_value: z.string().trim().min(1, "State the result").max(500),
  result_note: z.string().trim().max(2000).default(""),
  final_score: z.coerce
    .number({ invalid_type_error: "The % must be a number" })
    .min(0, "The % cannot be negative")
    .max(120, "The maximum % is 120"),
});

export const finalScoresPayload = z.array(finalScoreInput).min(1);

export const periodInput = z
  .object({
    label: z.string().trim().min(1, "Label required (e.g. H1 2026)").max(50),
    starts_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid start date"),
    ends_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid end date"),
  })
  .refine((p) => p.starts_on < p.ends_on, {
    message: "The start date must come before the end date",
  });

export const inviteInput = z.object({
  email: z.string().trim().email("Invalid email"),
  full_name: z.string().trim().min(1, "Name required").max(200),
});

export const teamInput = z.object({
  name: z.string().trim().min(1, "Team name required").max(100),
  manager_id: z.string().uuid().nullable(),
  parent_team_id: z.string().uuid().nullable(),
});

/**
 * Password requirements, aligned with the policy set on Supabase Auth:
 * minimum 10 characters with uppercase, lowercase, numbers, and symbols.
 * Supabase also rejects passwords that have already appeared in known
 * breaches (leaked password protection) — that's the protection that
 * matters most, but it can't be replicated here client-side. These checks
 * give a clear error message BEFORE the call: the real rule remains the
 * one enforced by the server.
 */
export const PASSWORD_MIN_LENGTH = 10;

export function passwordError(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `The password must be at least ${PASSWORD_MIN_LENGTH} characters long.`;
  }
  if (!/[a-z]/.test(password)) {
    return "The password must contain at least one lowercase letter.";
  }
  if (!/[A-Z]/.test(password)) {
    return "The password must contain at least one uppercase letter.";
  }
  if (!/[0-9]/.test(password)) {
    return "The password must contain at least one number.";
  }
  if (!/[^a-zA-Z0-9]/.test(password)) {
    return "The password must contain at least one symbol (e.g. ! ? # @).";
  }
  return null;
}

/**
 * Company email domains allowed for self sign-up. MUST stay in sync with
 * the is_allowed_signup_domain function on the database (migration 00007):
 * the check here only gives an immediate, readable error, the real filter
 * is the handle_new_user trigger.
 */
export const ALLOWED_EMAIL_DOMAINS = [
  "yourcompany.com",
  "secondbrand.com",
  "thirdbrand.com",
] as const;

export function isAllowedEmailDomain(email: string): boolean {
  const domain = email.trim().toLowerCase().split("@")[1];
  return ALLOWED_EMAIL_DOMAINS.some((d) => d === domain);
}
