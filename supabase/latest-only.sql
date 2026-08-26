-- 新生作业保留策略：每个学生、每个任务只保留最新一次。
-- 在 Supabase Dashboard -> SQL Editor -> New query 中执行一次。
-- 网站会先用 Storage API 删除旧文件，再调用此函数删除旧数据库记录。

create or replace function public.prune_submission_history(p_assignment_id text default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_deleted integer;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if p_assignment_id is not null and p_assignment_id !~ '^[a-z0-9][a-z0-9-]{1,63}$' then
    raise exception 'invalid assignment id';
  end if;
  with ranked as (
    select id,
      row_number() over (
        partition by assignment_id
        order by version desc, created_at desc, id desc
      ) as rn
    from public.submissions
    where user_id = auth.uid()
      and is_complete
      and (p_assignment_id is null or assignment_id = p_assignment_id)
  )
  delete from public.submissions s
  using ranked r
  where s.id = r.id and r.rn > 1;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.prune_submission_history(text) from public;
grant execute on function public.prune_submission_history(text) to authenticated;

-- 管理员登录后台时可一次清理所有学生的旧记录（网站会先删除对应文件）。
create or replace function public.admin_prune_submission_history()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_deleted integer;
begin
  if not public.is_admin(auth.uid()) then raise exception 'administrator access required'; end if;
  with ranked as (
    select id,
      row_number() over (
        partition by user_id, assignment_id
        order by version desc, created_at desc, id desc
      ) as rn
    from public.submissions
    where is_complete
  )
  delete from public.submissions s
  using ranked r
  where s.id = r.id and r.rn > 1;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.admin_prune_submission_history() from public;
grant execute on function public.admin_prune_submission_history() to authenticated;
