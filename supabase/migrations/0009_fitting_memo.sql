-- 피팅 저장 시 짧은 메모 (선택, 최대 500자)
alter table public.fittings add column if not exists memo text check (memo is null or char_length(memo) <= 500);
