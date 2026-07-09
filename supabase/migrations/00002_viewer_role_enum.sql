-- ============================================================================
-- Ruolo "viewer" (osservatore): sola lettura su tutti gli OKR del team.
-- Pensato per stakeholder (es. il responsabile del manager) che devono
-- consultare obiettivi e stati senza poter approvare o modificare nulla.
--
-- NB: ALTER TYPE ... ADD VALUE deve essere eseguito in una transazione
-- separata dalle istruzioni che usano il nuovo valore: per questo è in un
-- file di migrazione a sé, da eseguire PRIMA di 00003.
-- ============================================================================

alter type public.user_role add value if not exists 'viewer';
