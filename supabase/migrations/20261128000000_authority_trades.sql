-- AUD-167: what the library's name authority writes after a single name
-- is left out of it too. A heading of a name and a trade ("こもれび,
-- 漫画家", "kei, イラストレーター") was read as a family name and a given
-- one ("こもれび漫画家", "イラストレーター kei"); now a second part that is
-- a trade (private.bib_trade) leaves the name alone, as one that is years
-- does ("こもれび, pub. 2026"). src/lib/book-name.ts authorWords reads the
-- catalogue's headings the same way, with the same examples
-- (tests/fixtures/authority-names.ts). A reading gives its trade in kana
-- ("コモレビ, マンガカ"), and is read the same way.
--
-- The names already kept are made again: 20261125000000 made again only
-- the names with a comma, but the rule before it had put the years in
-- front of a single name ("pub. 2026 こもれび"), with no comma left. So a
-- name of the sources' answers (private.edition_sources) that is the one
-- either earlier rule made from its heading, and is not the one the rule
-- makes now, is made again; and a reading of such a person loses the
-- years or the trade the earlier rule kept in it ("pub. 2026 コモレビ",
-- "コモレビ マンガカ", "マンガカ KEI"). Then, as in 20261125000000, the
-- author of the catalog rows (books of 'ndl') whose editions' names
-- changed, and the readers' books of those editions are judged again
-- (book_rechecks; a verdict that stays the same changes nothing). 5 names
-- with years in front and 11 people of a trade in production on 10-20.
-- Nothing else changes, and no row is taken out.
--
-- Before that, the sources, the books, their checks and the books' search
-- words are copied (private.keep_copy), and compared after
-- (private.check_copy).
--
-- Rollback: a new migration that makes private.bib_person() again as
-- 20261125000000_authority_qualifiers.sql has it, and drops
-- private.bib_trade(); the names made again stay as they are (they are
-- what the heading says), or come back from the copy
-- keep."20261128000000_authority_trades" (private.restore_copy).

select private.keep_copy('20261128000000_authority_trades',
  array['private.edition_sources', 'public.books', 'private.book_checks',
    'private.book_grams']::regclass[]);

-- The rule of 20261101000000_bibliography.sql, to know the names it made.
create function pg_temp.first_person(raw text) returns text
language sql immutable as $$
  select case
    when m is null then n
    when (m[1] || m[2]) ~ '[A-Za-z]' then btrim(m[2]) || ' ' || btrim(m[1])
    else btrim(m[1]) || btrim(m[2])
  end
  from (select private.bib_text(regexp_replace(raw,
    '\s*,?\s*[0-9]{3,4}\??\s*-\s*([0-9]{3,4}\??)?\s*$', '')) as n) a
  cross join lateral (select regexp_match(n, '^([^,]+),([^,]+)$') as m) b
$$;

-- What the two earlier rules made of each heading, read before the
-- function changes.
create temporary table old_names on commit drop as
  select s.edition_id, s.source, x.n,
    pg_temp.first_person(x.c ->> 'heading') as first, private.bib_person(x.c ->> 'heading') as second
  from private.edition_sources s
  cross join lateral jsonb_array_elements(case when jsonb_typeof(s.fields -> 'creators') = 'array'
    then s.fields -> 'creators' else '[]' end) with ordinality x (c, n)
  where x.c ? 'heading';

-- A trade or a field the authority writes after a single name, or its
-- reading: the same words as TRADES in src/lib/book-name.ts, and their
-- readings. Spaces and the width of letters do not count.
create function private.bib_trade(word text) returns boolean
language sql immutable set search_path = '' as $$
  select w = any (array[
      '漫画家', '漫画原作者', '作家', '小説家', '絵本作家', '童話作家', '放送作家',
      '画家', '写真家', '歌手', '声優', '俳優', '女優', 'タレント', '翻訳家', '翻訳者',
      '詩人', '歌人', '俳人', '評論家', '料理研究家', '料理家', '作曲家', '作詞家',
      '脚本家', '医師', '弁護士', '漫画', '小説', '童話', '絵本', '写真', 'イラスト',
      '記者', '教師', '僧侶', '棋士', 'モデル', 'YouTuber', 'ユーチューバー', '実業家',
      '経営者', '研究者', '編集者', '落語家', '音楽家', '建築家', '占い師', '美容家',
      'ブロガー', '著述家', '文筆家', '随筆家', '研究家', '教育者', 'アナウンサー',
      'コラムニスト', '映画監督',
      'マンガカ', 'マンガゲンサクシャ', 'サッカ', 'ショウセツカ', 'エホンサッカ',
      'ドウワサッカ', 'ホウソウサッカ', 'シャシンカ', 'セイユウ', 'ハイユウ', 'ジョユウ',
      'ホンヤクカ', 'ホンヤクシャ', 'シジン', 'ヒョウロンカ', 'リョウリケンキュウカ',
      'リョウリカ', 'サッキョクカ', 'サクシカ', 'キャクホンカ', 'ベンゴシ', 'マンガ',
      'ショウセツ', 'ドウワ', 'エホン', 'シャシン', 'キョウシ', 'ソウリョ',
      'ジツギョウカ', 'ケイエイシャ', 'ケンキュウシャ', 'ヘンシュウシャ', 'ラクゴカ',
      'オンガクカ', 'ケンチクカ', 'ウラナイシ', 'ビヨウカ', 'チョジュツカ', 'ブンピツカ',
      'ズイヒツカ', 'ケンキュウカ', 'キョウイクシャ', 'エイガカントク'])
    or w ~ '(ライター|デザイナー|クリエイター|クリエーター|コンサルタント|アーティスト|ミュージシャン|イラストレーター|エッセイスト|カメラマン)$'
  from (select regexp_replace(normalize(coalesce(word, ''), nfkc), '\s', '', 'g') as w) x
$$;
revoke all on function private.bib_trade(text) from public, anon, authenticated;

create or replace function private.bib_person(raw text, apart text default '') returns text
language sql immutable set search_path = '' as $$
  select case
    when cardinality(p) < 2 or p[1] = '' then n
    when p[2] ~ '^(pub\.\s*)?-?[0-9]{2,4}[0-9.?]*(\s*-\s*[0-9]{0,4}\??)?[A-Z]?$'
      or private.bib_trade(p[2]) then p[1]
    when p[2] = '' then n
    when (p[1] || p[2]) ~ '[A-Za-z]' then concat_ws(' ', p[2], p[1],
      (select x from unnest(p[3:]) x where x ~ '^(Jr\.?|Sr\.?|II|III|IV)$' limit 1))
    else p[1] || apart || p[2]
  end
  from (select private.bib_text(regexp_replace(raw,
    '\s*,?\s*[0-9]{3,4}\??\s*-\s*([0-9]{3,4}\??)?\s*$', '')) as n) a
  cross join lateral (
    select array(select btrim(x) from regexp_split_to_table(n, ',') x) as p) b
$$;

-- What the authority writes after a single name: years or a trade.
create function pg_temp.after_name(heading text) returns boolean
language sql immutable as $$
  select cardinality(p) >= 2 and (private.bib_trade(p[2])
    or p[2] ~ '^(pub\.\s*)?-?[0-9]{2,4}[0-9.?]*(\s*-\s*[0-9]{0,4}\??)?[A-Z]?$')
  from (select array(select btrim(x) from regexp_split_to_table(private.bib_text(regexp_replace(heading,
    '\s*,?\s*[0-9]{3,4}\??\s*-\s*([0-9]{3,4}\??)?\s*$', '')), ',') x) as p) a
$$;

-- A reading the earlier rule made from "name, years" or "name, trade":
-- the years first ("pub. 2026 コモレビ"), the trade last ("コモレビ
-- マンガカ"), or first by a name in Latin letters ("マンガカ KEI").
create function pg_temp.first_reading(reading text) returns text
language sql immutable as $$
  select case
    when reading ~ '^(pub\.\s*)?-?[0-9]{2,4}[0-9.?]*(\s*-\s*[0-9]{0,4}\??)?[A-Z]?\s+\S'
      then regexp_replace(reading, '^(pub\.\s*)?-?[0-9]{2,4}[0-9.?]*(\s*-\s*[0-9]{0,4}\??)?[A-Z]?\s+', '')
    when cardinality(w) = 2 and private.bib_trade(w[2]) then w[1]
    when cardinality(w) = 2 and private.bib_trade(w[1]) and w[2] ~ '[A-Za-z]' then w[2]
    else reading
  end
  from (select regexp_split_to_array(btrim(reading), '\s+') as w) x
$$;

-- The people to name again: a name one of the earlier rules made from the
-- heading that the rule now makes another, or a reading of years or a
-- trade the authority wrote after a single name.
create temporary table authority_people on commit drop as
  select * from (
    select s.edition_id, s.source, x.n,
      x.c ->> 'name' in (old.first, old.second)
        and x.c ->> 'name' <> private.bib_person(x.c ->> 'heading') as renamed,
      x.c ->> 'reading' as was,
      case when pg_temp.after_name(x.c ->> 'heading') then pg_temp.first_reading(x.c ->> 'reading')
        else x.c ->> 'reading' end as reading
    from private.edition_sources s
    cross join lateral jsonb_array_elements(case when jsonb_typeof(s.fields -> 'creators') = 'array'
      then s.fields -> 'creators' else '[]' end) with ordinality x (c, n)
    join old_names old on old.edition_id = s.edition_id and old.source = s.source and old.n = x.n) p
  where renamed or reading is distinct from was;

update private.edition_sources s set fields = jsonb_set(s.fields, '{creators}', (
    select jsonb_agg(case when f.n is null then x.c
        else x.c || jsonb_strip_nulls(jsonb_build_object(
          'name', case when f.renamed then private.bib_person(x.c ->> 'heading') end,
          'reading', f.reading)) end
      order by x.n)
    from jsonb_array_elements(s.fields -> 'creators') with ordinality x (c, n)
    left join authority_people f on f.edition_id = s.edition_id and f.source = s.source and f.n = x.n))
where exists (select 1 from authority_people f where f.edition_id = s.edition_id and f.source = s.source);

-- The catalog rows of those editions, named by the master's people as
-- catalog_take and catalog_promote name them, and judged the same as when
-- they came (the update has them judged again, book_retitled).
create temporary table authority_rows on commit drop as
  select b.id, w.author
  from public.books b
  cross join lateral private.edition_bibliography(b.edition_id) m
  cross join lateral private.catalog_words(jsonb_build_object('title', 'x', 'creators', m.creators)) w
  where b.source = 'ndl'
    and b.edition_id in (select f.edition_id from authority_people f)
    and b.author is distinct from w.author;
update public.books b set author = r.author from authority_rows r where b.id = r.id;
update private.book_checks c set checked_at = now(), confirmed_at = null
from authority_rows r where c.book_id = r.id;

insert into private.book_rechecks (book_id)
  select b.id from public.books b
  where b.source = 'manual' and b.edition_id in (select f.edition_id from authority_people f)
on conflict do nothing;

select private.check_copy('20261128000000_authority_trades');
