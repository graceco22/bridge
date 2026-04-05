create extension if not exists pgcrypto;

create table if not exists public.volunteers (
	id uuid primary key default gen_random_uuid(),
	first_name text not null,
	last_name text not null,
	email text not null unique,
	linkedin_url text not null unique,
	linkedin_raw_text text,
	skills text[] not null default '{}',
	languages text[] not null default '{}',
	interests text[] not null default '{}',
	location text,
	availability text,
	impact_score integer not null default 0,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

create table if not exists public.volunteer_requests (
	id uuid primary key default gen_random_uuid(),
	manager_user_id uuid,
	organization_name text,
	request_text text not null,
	skills_needed text[] not null default '{}',
	location text,
	volunteers_needed integer not null default 1,
	event_date date,
	status text not null default 'draft',
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

create table if not exists public.outreach_messages (
	id uuid primary key default gen_random_uuid(),
	request_id uuid not null references public.volunteer_requests (id) on delete cascade,
	volunteer_id uuid not null references public.volunteers (id) on delete cascade,
	email_subject text not null,
	email_body text not null,
	match_score numeric(5,2) not null default 0,
	send_status text not null default 'draft',
	sent_at timestamptz,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	unique (request_id, volunteer_id)
);

create index if not exists volunteers_location_idx on public.volunteers (location);
create index if not exists volunteers_skills_idx on public.volunteers using gin (skills);
create index if not exists volunteer_requests_status_idx on public.volunteer_requests (status);
create index if not exists outreach_messages_request_id_idx on public.outreach_messages (request_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
	new.updated_at = now();
	return new;
end;
$$;

create trigger set_volunteers_updated_at
before update on public.volunteers
for each row execute function public.set_updated_at();

create trigger set_volunteer_requests_updated_at
before update on public.volunteer_requests
for each row execute function public.set_updated_at();

create trigger set_outreach_messages_updated_at
before update on public.outreach_messages
for each row execute function public.set_updated_at();
