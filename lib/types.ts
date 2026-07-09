export type UserRole = "member" | "manager" | "viewer";

export type OkrStatus =
  | "draft"
  | "submitted"
  | "changes_requested"
  | "approved"
  | "evaluation"
  | "completed";

export interface Profile {
  id: string;
  team_id: string;
  full_name: string;
  email: string;
  role: UserRole;
  created_at: string;
}

export interface Period {
  id: string;
  team_id: string;
  label: string;
  starts_on: string;
  ends_on: string;
}

export interface OkrSet {
  id: string;
  profile_id: string;
  period_id: string;
  status: OkrStatus;
  final_score: number | null;
  submitted_at: string | null;
  approved_at: string | null;
  results_proposed_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Objective {
  id: string;
  set_id: string;
  position: number;
  objective: string;
  key_result: string;
  smart_requirements: string;
  starting_point: string;
  target_outcome: string;
  metric_type: string;
  weight: number;
  result_value: string | null;
  result_note: string | null;
  proposed_score: number | null;
  final_score: number | null;
}

export interface ReviewComment {
  id: string;
  set_id: string;
  objective_id: string | null;
  author_id: string;
  body: string;
  created_at: string;
  author?: { full_name: string } | null;
}

export type ActionResult = { ok?: true; error?: string };
