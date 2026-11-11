begin;

set local lock_timeout = '5s';

-- Reemplazar las FK por sus columnas y destinos, aunque sus nombres difieran
-- de los del README. Detenerse si aparece una relación distinta.
do $$
declare
  relation record;
  old_fk record;
begin
  for relation in
    select * from (values
      ('orders', 'user_id', 'profiles', 'orders_user_id_fkey'),
      ('orders', 'location_id', 'locations', 'orders_location_id_fkey'),
      ('order_items', 'order_id', 'orders', 'order_items_order_id_fkey'),
      ('order_items', 'product_id', 'products', 'order_items_product_id_fkey')
    ) as mapping(source_table, source_column, target_table, constraint_name)
  loop
    execute format('lock table public.%I in access exclusive mode', relation.source_table);
    for old_fk in
      select c.conname, c.conkey, c.confrelid, c.confkey,
             src.attnum as source_attnum, dst.attnum as target_attnum, dst.attrelid as target_oid
      from pg_constraint as c
      join pg_attribute as src
        on src.attrelid = c.conrelid and src.attname = relation.source_column
      join pg_attribute as dst
        on dst.attrelid = format('public.%I', relation.target_table)::regclass and dst.attname = 'id'
      where c.conrelid = format('public.%I', relation.source_table)::regclass
        and c.contype = 'f'
        and src.attnum = any(c.conkey)
    loop
      if old_fk.conkey <> array[old_fk.source_attnum]
         or old_fk.confrelid <> old_fk.target_oid
         or old_fk.confkey <> array[old_fk.target_attnum] then
        raise exception 'REC-01: FK inesperada de %.%: %',
          relation.source_table, relation.source_column, old_fk.conname;
      end if;
      execute format('alter table public.%I drop constraint %I',
        relation.source_table, old_fk.conname);
    end loop;

    execute format(
      'alter table public.%I add constraint %I foreign key (%I) references public.%I (id) on delete restrict',
      relation.source_table, relation.constraint_name, relation.source_column, relation.target_table
    );
  end loop;
end;
$$;

create index if not exists orders_user_id_idx on public.orders (user_id);
create index if not exists orders_location_id_idx on public.orders (location_id);
create index if not exists order_items_product_id_idx on public.order_items (product_id);

commit;
