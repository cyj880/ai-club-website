-- ============================================================
-- 管理员角色管理升级（增量脚本，在 Supabase SQL Editor 执行一次）
--
-- 作用：
--   1. 新增 owner（群主）角色：唯一，拥有最高管理权限
--   2. 群主可以在网页后台直接把成员设为管理员 / 移除管理员
--   3. admin 和 owner 拥有相同的管理查看权限（is_admin 同时认可两者）
--
-- 使用方法：
--   1. 全文执行本脚本
--   2. 执行文件末尾的 UPDATE，把自己的邮箱填进去，将你自己设为群主
--   3. 刷新 admin.html 即可看到成员管理按钮
-- ============================================================

-- 1. 放宽角色约束：student（成员）/ admin（管理员）/ owner（群主）
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('student', 'admin', 'owner'));

-- 2. 管理权限判断同时认可 admin 和 owner（所有 RLS 策略自动生效）
create or replace function public.is_admin(p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = p_user_id and role in ('admin', 'owner')
  );
$$;

revoke all on function public.is_admin(uuid) from public;
grant execute on function public.is_admin(uuid) to authenticated;

-- 3. 群主专属：设置 / 移除管理员
--    - 只有 owner 能调用
--    - 只能在 student 和 admin 之间切换，不能改动其他群主
create or replace function public.admin_set_role(p_target_user_id uuid, p_new_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_role text;
begin
  select role into v_caller_role from public.profiles where id = auth.uid();
  if v_caller_role is distinct from 'owner' then
    raise exception '只有群主可以设置管理员';
  end if;

  if p_new_role not in ('student', 'admin') then
    raise exception '无效的目标角色';
  end if;

  if not exists (
    select 1 from public.profiles
    where id = p_target_user_id and role in ('student', 'admin')
  ) then
    raise exception '目标成员不存在或无法修改';
  end if;

  update public.profiles set role = p_new_role where id = p_target_user_id;
end;
$$;

revoke execute on function public.admin_set_role(uuid, text) from public, anon;
grant execute on function public.admin_set_role(uuid, text) to authenticated;

-- 4. 把你自己设为群主（把下面引号里的内容换成你注册时用的邮箱后执行）
-- update public.profiles set role = 'owner' where email = '你的注册邮箱';
