-- ============================================================================
-- "viewer" role: read-only access to all of the team's OKRs.
-- Meant for stakeholders (e.g. the manager's manager) who need to review
-- objectives and statuses without being able to approve or change anything.
--
-- NB: ALTER TYPE ... ADD VALUE must run in a transaction separate from any
-- statement that uses the new value: that's why it's in its own migration
-- file, to be run BEFORE 00003.
-- ============================================================================

alter type public.user_role add value if not exists 'viewer';
