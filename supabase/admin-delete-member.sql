-- ============================================================
-- 删除成员功能（增量脚本，在 Supabase SQL Editor 执行一次）
--
-- 作用：群主在网页管理后台可以直接删除成员账号。
--   - 账号、资料、全部作业提交记录、上传的文件一并删除，不可恢复
--   - 只有 owner（群主）能调用此功能
--   - 不能删除群主自己的账号
--   - 浏览器端不接触任何高权限密钥
--
-- 执行方法：全文粘贴到 Supabase SQL Editor，点 Run。
-- ============================================================

create or replace function public.admin_delete_member(p_target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  v_caller_role text;
  v_target_role text;
begin
  -- 只有群主可以删除成员
  select role into v_caller_role from public.profiles where id = auth.uid();
  if v_caller_role is distinct from 'owner' then
    raise exception '只有群主可以删除成员';
  end if;

  -- 目标必须存在，且不能是群主
  select role into v_target_role from public.profiles where id = p_target_user_id;
  if v_target_role is null then
    raise exception '目标成员不存在';
  end if;
  if v_target_role = 'owner' then
    raise exception '不能删除群主账号';
  end if;

  -- 1. 删除私有存储桶中该用户的全部文件（路径以 用户ID/ 开头）
  delete from storage.objects
  where bucket_id = 'homework-private'
    and name like p_target_user_id::text || '/%';

  -- 2. 删除认证用户；profiles / submissions / attachments 由外键级联删除
  delete from auth.users where id = p_target_user_id;
end;
$$;

revoke execute on function public.admin_delete_member(uuid) from public, anon;
grant execute on function public.admin_delete_member(uuid) to authenticated;
