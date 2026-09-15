-- Optional breakdown for multi-signal scorer (v2). Safe to run on existing projects.
alter table public.match_scores
  add column if not exists score_components jsonb;

comment on column public.match_scores.score_components is 'Debug breakdown when SCORING_ENGINE=v2 (semantic, title, org, etc.)';

insert into public.system_settings (key, value, description)
values (
  'watch_threshold',
  '0.60',
  'Minimum match score for Watch tab (between Other and Strong)'
)
on conflict (key) do nothing;
