-- 人工智能协会新生学习与作业系统
-- 在全新的 Supabase 项目中通过 SQL Editor 完整执行本文件。
-- 可重复执行；不会创建管理员，也不会包含任何明文邀请码。

create extension if not exists pgcrypto with schema extensions;

-- ---------- 数据表 ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null check (char_length(full_name) between 1 and 50),
  student_id text not null unique check (char_length(student_id) between 4 and 30),
  major_class text not null check (char_length(major_class) between 2 and 80),
  qq text not null check (qq ~ '^[1-9][0-9]{4,11}$'),
  cohort_label text not null check (char_length(cohort_label) between 1 and 40),
  role text not null default 'student' check (role in ('student', 'admin')),
  deletion_requested_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.invitation_codes (
  id uuid primary key default gen_random_uuid(),
  cohort_label text not null check (char_length(cohort_label) between 1 and 40),
  code_hash bytea not null unique,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  disabled_at timestamptz
);

create unique index if not exists invitation_codes_one_active_per_cohort
  on public.invitation_codes (lower(cohort_label)) where is_active;

create table if not exists public.submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  course_id text not null check (course_id ~ '^[a-z0-9][a-z0-9-]{1,63}$'),
  assignment_id text not null check (assignment_id ~ '^[a-z0-9][a-z0-9-]{1,63}$'),
  version integer not null check (version > 0),
  description text not null default '' check (char_length(description) between 0 and 2000),
  repository_url text check (repository_url is null or (char_length(repository_url) <= 500 and repository_url ~ '^https://')),
  is_complete boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, assignment_id, version)
);

create index if not exists submissions_user_assignment_idx on public.submissions (user_id, assignment_id, version desc);
create index if not exists submissions_created_idx on public.submissions (created_at desc);

create table if not exists public.attachments (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions(id) on delete cascade,
  storage_path text not null unique,
  original_name text not null check (char_length(original_name) between 1 and 255),
  mime_type text not null check (mime_type in ('application/zip', 'application/pdf', 'image/png', 'image/jpeg')),
  size_bytes bigint not null check (size_bytes between 1 and 20971520),
  created_at timestamptz not null default now()
);

create index if not exists attachments_submission_idx on public.attachments (submission_id);

-- ---------- 通用权限判断 ----------
create or replace function public.is_admin(p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = p_user_id and role = 'admin'
  );
$$;

revoke all on function public.is_admin(uuid) from public;
grant execute on function public.is_admin(uuid) to authenticated;

-- ---------- 注册与邀请码 ----------
create or replace function public.validate_invite_code(p_code text)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select exists (
    select 1 from public.invitation_codes
    where is_active and code_hash = extensions.digest(coalesce(p_code, ''), 'sha256')
  );
$$;

revoke all on function public.validate_invite_code(text) from public;
grant execute on function public.validate_invite_code(text) to anon, authenticated;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_invite public.invitation_codes%rowtype;
  v_name text := trim(coalesce(new.raw_user_meta_data ->> 'full_name', ''));
  v_student_id text := trim(coalesce(new.raw_user_meta_data ->> 'student_id', ''));
  v_major_class text := trim(coalesce(new.raw_user_meta_data ->> 'major_class', ''));
  v_qq text := trim(coalesce(new.raw_user_meta_data ->> 'qq', ''));
  v_code text := coalesce(new.raw_user_meta_data ->> 'invite_code', '');
begin
  select * into v_invite
  from public.invitation_codes
  where is_active and code_hash = extensions.digest(v_code, 'sha256')
  limit 1;

  if not found then raise exception 'invalid invite code'; end if;
  if char_length(v_name) not between 1 and 50 then raise exception 'invalid full name'; end if;
  if char_length(v_student_id) not between 4 and 30 then raise exception 'invalid student id'; end if;
  if char_length(v_major_class) not between 2 and 80 then raise exception 'invalid major class'; end if;
  if v_qq !~ '^[1-9][0-9]{4,11}$' then raise exception 'invalid qq'; end if;

  insert into public.profiles (id, email, full_name, student_id, major_class, qq, cohort_label, role)
  values (new.id, coalesce(new.email, ''), v_name, v_student_id, v_major_class, v_qq, v_invite.cohort_label, 'student');
  -- 邀请码只用于本次服务端校验，不保留在认证用户元数据中。
  update auth.users
  set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) - 'invite_code'
  where id = new.id;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_auth_user();

create or replace function public.admin_create_invite(p_cohort_label text, p_code text)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_id uuid;
begin
  if not public.is_admin(auth.uid()) then raise exception 'administrator access required'; end if;
  p_cohort_label := trim(coalesce(p_cohort_label, ''));
  if char_length(p_cohort_label) not between 1 and 40 then raise exception 'invalid cohort label'; end if;
  if char_length(coalesce(p_code, '')) not between 10 and 64 then raise exception 'invite code must contain 10 to 64 characters'; end if;

  update public.invitation_codes
  set is_active = false, disabled_at = now()
  where lower(cohort_label) = lower(p_cohort_label) and is_active;

  insert into public.invitation_codes (cohort_label, code_hash, is_active, created_by)
  values (p_cohort_label, extensions.digest(p_code, 'sha256'), true, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.admin_set_invite_active(p_invite_id uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_cohort text;
begin
  if not public.is_admin(auth.uid()) then raise exception 'administrator access required'; end if;
  select cohort_label into v_cohort from public.invitation_codes where id = p_invite_id;
  if not found then raise exception 'invite not found'; end if;
  if p_active then
    update public.invitation_codes set is_active = false, disabled_at = now()
    where lower(cohort_label) = lower(v_cohort) and is_active and id <> p_invite_id;
  end if;
  update public.invitation_codes
  set is_active = p_active, disabled_at = case when p_active then null else now() end
  where id = p_invite_id;
end;
$$;

revoke all on function public.admin_create_invite(text, text) from public;
revoke all on function public.admin_set_invite_active(uuid, boolean) from public;
grant execute on function public.admin_create_invite(text, text) to authenticated;
grant execute on function public.admin_set_invite_active(uuid, boolean) to authenticated;

-- ---------- 作业版本和附件 ----------
create or replace function public.create_submission(
  p_course_id text,
  p_assignment_id text,
  p_description text,
  p_repository_url text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_version integer; v_id uuid;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'student') then raise exception 'student account required'; end if;
  if p_course_id !~ '^[a-z0-9][a-z0-9-]{1,63}$' or p_assignment_id !~ '^[a-z0-9][a-z0-9-]{1,63}$' then raise exception 'invalid assignment id'; end if;
  p_description := trim(coalesce(p_description, ''));
  if char_length(p_description) not between 0 and 2000 then raise exception 'description must not exceed 2000 characters'; end if;
  p_repository_url := nullif(trim(coalesce(p_repository_url, '')), '');
  if p_repository_url is not null and (char_length(p_repository_url) > 500 or p_repository_url !~ '^https://') then raise exception 'repository url must use https'; end if;

  perform pg_advisory_xact_lock(hashtext(auth.uid()::text || ':' || p_assignment_id));
  select coalesce(max(version), 0) + 1 into v_version
  from public.submissions where user_id = auth.uid() and assignment_id = p_assignment_id;

  insert into public.submissions (user_id, course_id, assignment_id, version, description, repository_url)
  values (auth.uid(), p_course_id, p_assignment_id, v_version, p_description, p_repository_url)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'version', v_version);
end;
$$;

create or replace function public.register_attachment(
  p_submission_id uuid,
  p_storage_path text,
  p_original_name text,
  p_mime_type text,
  p_size_bytes bigint
)
returns uuid
language plpgsql
security definer
set search_path = public, storage
as $$
declare v_submission public.submissions%rowtype; v_id uuid; v_count integer; v_total bigint; v_object_metadata jsonb;
begin
  select * into v_submission from public.submissions
  where id = p_submission_id and user_id = auth.uid() and not is_complete;
  if not found then raise exception 'open submission not found'; end if;
  if p_storage_path !~ ('^' || auth.uid()::text || '/' || v_submission.assignment_id || '/' || v_submission.version::text || '/[^/]+$') then raise exception 'invalid storage path'; end if;
  if p_mime_type not in ('application/zip', 'application/pdf', 'image/png', 'image/jpeg') then raise exception 'unsupported file type'; end if;
  if p_size_bytes not between 1 and 20971520 then raise exception 'invalid file size'; end if;
  if char_length(coalesce(p_original_name, '')) not between 1 and 255 then raise exception 'invalid file name'; end if;
  select metadata into v_object_metadata
  from storage.objects where bucket_id = 'homework-private' and name = p_storage_path;
  if not found then raise exception 'uploaded object not found'; end if;
  if coalesce(v_object_metadata ->> 'mimetype', '') <> p_mime_type
     or coalesce((v_object_metadata ->> 'size')::bigint, 0) <> p_size_bytes then
    raise exception 'attachment metadata mismatch';
  end if;

  select count(*), coalesce(sum(size_bytes), 0) into v_count, v_total
  from public.attachments where submission_id = p_submission_id;
  if v_count >= 5 then raise exception 'no more than 5 files are allowed'; end if;
  if v_total + p_size_bytes > 20971520 then raise exception 'total file size exceeds 20MB'; end if;

  insert into public.attachments (submission_id, storage_path, original_name, mime_type, size_bytes)
  values (p_submission_id, p_storage_path, p_original_name, p_mime_type, p_size_bytes)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.complete_submission(p_submission_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.submissions s
    where s.id = p_submission_id and s.user_id = auth.uid() and not s.is_complete
      and (select count(*) from public.attachments a where a.submission_id = s.id) between 1 and 5
  ) then raise exception 'submission has no valid attachments'; end if;
  update public.submissions set is_complete = true where id = p_submission_id and user_id = auth.uid();
end;
$$;

create or replace function public.discard_submission(p_submission_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.submissions where id = p_submission_id and user_id = auth.uid() and not is_complete;
end;
$$;

create or replace function public.set_deletion_request(p_requested boolean)
returns void
language sql
security definer
set search_path = public
as $$
  update public.profiles
  set deletion_requested_at = case when p_requested then now() else null end,
      updated_at = now()
  where id = auth.uid();
$$;

revoke all on function public.create_submission(text, text, text, text) from public;
revoke all on function public.register_attachment(uuid, text, text, text, bigint) from public;
revoke all on function public.complete_submission(uuid) from public;
revoke all on function public.discard_submission(uuid) from public;
revoke all on function public.set_deletion_request(boolean) from public;
grant execute on function public.create_submission(text, text, text, text) to authenticated;
grant execute on function public.register_attachment(uuid, text, text, text, bigint) to authenticated;
grant execute on function public.complete_submission(uuid) to authenticated;
grant execute on function public.discard_submission(uuid) to authenticated;
grant execute on function public.set_deletion_request(boolean) to authenticated;

-- ---------- 数据库行级权限 ----------
alter table public.profiles enable row level security;
alter table public.invitation_codes enable row level security;
alter table public.submissions enable row level security;
alter table public.attachments enable row level security;

drop policy if exists profiles_select_own_or_admin on public.profiles;
create policy profiles_select_own_or_admin on public.profiles for select to authenticated
using (id = auth.uid() or public.is_admin(auth.uid()));

drop policy if exists invites_admin_select on public.invitation_codes;
create policy invites_admin_select on public.invitation_codes for select to authenticated
using (public.is_admin(auth.uid()));

drop policy if exists submissions_select_own_or_admin on public.submissions;
create policy submissions_select_own_or_admin on public.submissions for select to authenticated
using (user_id = auth.uid() or public.is_admin(auth.uid()));

drop policy if exists attachments_select_own_or_admin on public.attachments;
create policy attachments_select_own_or_admin on public.attachments for select to authenticated
using (
  public.is_admin(auth.uid()) or exists (
    select 1 from public.submissions s where s.id = submission_id and s.user_id = auth.uid()
  )
);

revoke all on public.profiles, public.invitation_codes, public.submissions, public.attachments from anon, authenticated;
grant select on public.profiles, public.invitation_codes, public.submissions, public.attachments to authenticated;

-- ---------- 私有作业存储 ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'homework-private', 'homework-private', false, 20971520,
  array['application/zip', 'application/pdf', 'image/png', 'image/jpeg']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.can_upload_homework_object(p_name text, p_metadata jsonb)
returns boolean
language plpgsql
stable
security definer
set search_path = public, storage
as $$
declare v_parts text[]; v_size bigint; v_count integer; v_total bigint;
begin
  v_parts := string_to_array(p_name, '/');
  if array_length(v_parts, 1) <> 4 or v_parts[1] <> auth.uid()::text or v_parts[3] !~ '^[1-9][0-9]*$' then return false; end if;
  if coalesce(p_metadata ->> 'mimetype', '') not in ('application/zip', 'application/pdf', 'image/png', 'image/jpeg') then return false; end if;
  begin v_size := (p_metadata ->> 'size')::bigint; exception when others then return false; end;
  if v_size not between 1 and 20971520 then return false; end if;
  if not exists (
    select 1 from public.submissions s
    where s.user_id = auth.uid() and not s.is_complete
      and s.assignment_id = v_parts[2] and s.version = v_parts[3]::integer
  ) then return false; end if;
  select count(*), coalesce(sum((metadata ->> 'size')::bigint), 0) into v_count, v_total
  from storage.objects
  where bucket_id = 'homework-private'
    and name like (auth.uid()::text || '/' || v_parts[2] || '/' || v_parts[3] || '/%');
  return v_count < 5 and v_total + v_size <= 20971520;
end;
$$;

revoke all on function public.can_upload_homework_object(text, jsonb) from public;
grant execute on function public.can_upload_homework_object(text, jsonb) to authenticated;

drop policy if exists homework_object_insert_own_open_submission on storage.objects;
create policy homework_object_insert_own_open_submission on storage.objects for insert to authenticated
with check (bucket_id = 'homework-private' and public.can_upload_homework_object(name, metadata));

drop policy if exists homework_object_select_authorized on storage.objects;
create policy homework_object_select_authorized on storage.objects for select to authenticated
using (
  bucket_id = 'homework-private' and (
    public.is_admin(auth.uid()) or exists (
      select 1 from public.attachments a
      join public.submissions s on s.id = a.submission_id
      where a.storage_path = name and s.user_id = auth.uid()
    )
  )
);

drop policy if exists homework_object_delete_own_or_admin on storage.objects;
create policy homework_object_delete_own_or_admin on storage.objects for delete to authenticated
using (
  bucket_id = 'homework-private' and (
    public.is_admin(auth.uid()) or split_part(name, '/', 1) = auth.uid()::text
  )
);

-- ---------- 首次启用（执行完整文件后手动进行） ----------
-- 1. 在 SQL Editor 运行下一条，将占位内容替换为强邀请码；不要把实际邀请码保存到仓库：
-- insert into public.invitation_codes (cohort_label, code_hash)
-- values ('2026 级', extensions.digest('替换为至少10位的首次邀请码', 'sha256'));
-- 2. 用该邀请码在网页注册负责人的普通账号并完成邮箱验证。
-- 3. 回到 SQL Editor，将对应邮箱安全指定为第一位管理员：
-- update public.profiles set role = 'admin' where email = '负责人注册邮箱';
