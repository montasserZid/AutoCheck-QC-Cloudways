-- Reviewed aliases may be valid only for a bounded model-year interval.
-- Null boundaries intentionally represent an open interval.

alter table knowledge.model_alias
  add column valid_from_year smallint,
  add column valid_to_year smallint,
  add constraint model_alias_valid_year_range_check check (
    (valid_from_year is null or valid_from_year between 1886 and 2100)
    and (valid_to_year is null or valid_to_year between 1886 and 2100)
    and (
      valid_from_year is null
      or valid_to_year is null
      or valid_from_year <= valid_to_year
    )
  );

comment on column knowledge.model_alias.valid_from_year is
  'Inclusive reviewed lower model-year boundary for this alias; null is open-ended.';
comment on column knowledge.model_alias.valid_to_year is
  'Inclusive reviewed upper model-year boundary for this alias; null is open-ended.';
