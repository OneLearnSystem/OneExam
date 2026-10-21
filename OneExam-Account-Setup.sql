-- OneExam 1.0: additive, isolated student data. Run once in Supabase SQL Editor.
begin;
create table if not exists public.oneexam_progress (
 user_id uuid primary key references auth.users(id) on delete cascade,
 payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload)='object' and octet_length(payload::text)<2000000),
 revision bigint not null default 0,
 updated_at timestamptz not null default now()
);
alter table public.oneexam_progress enable row level security;
drop policy if exists oneexam_own_read on public.oneexam_progress;
create policy oneexam_own_read on public.oneexam_progress for select to authenticated using (user_id=auth.uid());
revoke all on public.oneexam_progress from anon,authenticated;
grant select on public.oneexam_progress to authenticated;
create or replace function public.oneexam_save(p_payload jsonb,p_revision bigint)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare uid uuid:=auth.uid(); r bigint;
begin
 if uid is null then raise exception 'Please sign in'; end if;
 if jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>=2000000 then raise exception 'Progress is too large'; end if;
 insert into public.oneexam_progress(user_id) values(uid) on conflict do nothing;
 update public.oneexam_progress set payload=p_payload,revision=revision+1,updated_at=now()
 where user_id=uid and revision=p_revision returning revision into r;
 if r is null then raise exception 'Progress changed on another device. Reload before saving.'; end if;
 return jsonb_build_object('revision',r);
end $$;
revoke all on function public.oneexam_save(jsonb,bigint) from public,anon;
grant execute on function public.oneexam_save(jsonb,bigint) to authenticated;
commit;
