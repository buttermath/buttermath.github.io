-- Recipe links stop working when the recipe is deleted (Hayley OK'd, Nov 20, 2026).
-- A recipe link keeps its own copy of the recipe, so without this a link kept working after
-- the sender deleted the recipe. People who already opened the link keep their copy.
-- Adds one function and one trigger. The only rows it removes are links to deleted recipes.

create or replace function public.recipe_links_recipe_gone() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from recipe_links where recipe = old.id and sender = old.user_id;
  return old;
end $$;

revoke all on function public.recipe_links_recipe_gone() from public, anon, authenticated;

create or replace trigger recipe_links_recipe_gone
  after delete on public.recipes
  for each row execute function public.recipe_links_recipe_gone();

-- One time (safe to run again): links to recipes that were deleted before this trigger existed.
-- 1 such link on Nov 20, 2026.
delete from public.recipe_links l where not exists (select 1 from public.recipes r where r.id = l.recipe);
