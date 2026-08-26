-- 飞书同步增量 SQL（已有项目执行一次即可）。
-- 不包含 App Secret、service_role 或任何邀请码。
alter table public.profiles add column if not exists feishu_record_id text;

create unique index if not exists profiles_feishu_record_id_key
  on public.profiles (feishu_record_id)
  where feishu_record_id is not null;

-- Edge Function 的 sb_secret_... 会映射为 service_role。该角色绕过 RLS，
-- 但仍需要最小表级权限才能读取同步数据并保存飞书记录 ID。
grant select on public.profiles, public.submissions to service_role;
grant update (feishu_record_id) on public.profiles to service_role;

-- 用同步密钥保护的后端 RPC。Edge Function 通过这些 RPC 读取/更新数据，
-- 不直接依赖 PostgREST 对 profiles 表的角色授权；普通访客即使知道函数名，
-- 没有 Vault 中的同步密钥也只能得到错误。
create or replace function public.feishu_sync_check_secret(p_sync_secret text)
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
begin
  if p_sync_secret is null or not exists (
    select 1 from vault.decrypted_secrets
    where name = 'feishu_sync_webhook_secret'
      and decrypted_secret = p_sync_secret
  ) then
    raise exception 'invalid sync secret';
  end if;
end;
$$;

create or replace function public.feishu_get_profile(
  p_user_id uuid,
  p_sync_secret text
)
returns jsonb
language plpgsql
security definer
set search_path = public, vault
as $$
declare v_profile jsonb;
begin
  perform public.feishu_sync_check_secret(p_sync_secret);
  select jsonb_build_object(
    'id', id,
    'full_name', full_name,
    'role', role,
    'feishu_record_id', feishu_record_id
  ) into v_profile
  from public.profiles
  where id = p_user_id;
  return v_profile;
end;
$$;

create or replace function public.feishu_set_record_id(
  p_user_id uuid,
  p_record_id text,
  p_sync_secret text
)
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
begin
  perform public.feishu_sync_check_secret(p_sync_secret);
  if p_record_id is null or char_length(p_record_id) > 200 then
    raise exception 'invalid Feishu record id';
  end if;
  update public.profiles
  set feishu_record_id = p_record_id, updated_at = now()
  where id = p_user_id and role = 'student';
end;
$$;

create or replace function public.feishu_backfill(p_sync_secret text)
returns jsonb
language plpgsql
security definer
set search_path = public, vault
as $$
begin
  perform public.feishu_sync_check_secret(p_sync_secret);
  return jsonb_build_object(
    'profiles', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', id,
        'full_name', full_name,
        'role', role,
        'feishu_record_id', feishu_record_id
      ) order by created_at)
      from public.profiles where role = 'student'
    ), '[]'::jsonb),
    'submissions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', user_id,
        'assignment_id', assignment_id
      ) order by created_at)
      from public.submissions where is_complete = true
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.feishu_sync_check_secret(text) from public;
revoke all on function public.feishu_get_profile(uuid, text) from public;
revoke all on function public.feishu_set_record_id(uuid, text, text) from public;
revoke all on function public.feishu_backfill(text) from public;
grant execute on function public.feishu_sync_check_secret(text) to anon, authenticated, service_role;
grant execute on function public.feishu_get_profile(uuid, text) to anon, authenticated, service_role;
grant execute on function public.feishu_set_record_id(uuid, text, text) to anon, authenticated, service_role;
grant execute on function public.feishu_backfill(text) to anon, authenticated, service_role;
