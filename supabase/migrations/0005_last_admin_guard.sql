-- 마지막 관리자 보호: 관리자가 1명 남았을 때 강등·삭제를 DB에서 막는다.
create or replace function public.guard_last_admin() returns trigger
language plpgsql as $$
begin
  if (tg_op = 'UPDATE' and old.site_role = 'admin' and new.site_role <> 'admin')
     or (tg_op = 'DELETE' and old.site_role = 'admin') then
    if (select count(*) from public.profiles where site_role = 'admin' and id <> old.id) = 0 then
      raise exception 'last_admin_protected';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
drop trigger if exists trg_guard_last_admin on public.profiles;
create trigger trg_guard_last_admin before update or delete on public.profiles
  for each row execute function public.guard_last_admin();
