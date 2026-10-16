-- ============================================================
--  Blue Crane Vistas Portal — Conduct Rules (Phase 1)
--
--  Stores a reference to the current conduct-rules document. The file
--  itself lives in the existing "photos" storage bucket (any file type).
--  Trustees upload/replace it; every signed-in user can read it.
--
--  Run AFTER 12_fix_assignee_ticket_visibility.sql.
-- ============================================================

create table if not exists documents (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null,              -- e.g. 'conduct_rules'
  title         text,
  storage_path  text not null,              -- path within the storage bucket
  uploaded_by   uuid references profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);

create index if not exists idx_documents_kind on documents(kind, created_at desc);

alter table documents enable row level security;

-- Any signed-in user can read documents (so all residents see the rules).
drop policy if exists "read documents" on documents;
create policy "read documents" on documents for select
  using ( auth.uid() is not null );

-- Only trustees add/replace/remove documents.
drop policy if exists "trustee writes documents" on documents;
create policy "trustee writes documents" on documents for all
  using ( is_trustee() ) with check ( is_trustee() );
