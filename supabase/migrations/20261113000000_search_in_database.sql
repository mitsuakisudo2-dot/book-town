-- The search asked of the database (AUD-006 6b; docs/09「本の検索」と「開いた
-- 画面の分だけ読むもの」). The app searched only the books the town had read
-- (the newest 300 and the ones its rows point to), so a book used where
-- everyone can see it but not in the town was not found, and the search
-- needed the whole town to be read. Now the search page also asks the
-- database (find_books), which looks through every book the reader may read,
-- and the app ranks what comes back with what it has, as before.
--
-- How the database finds them, quickly as books are added:
--
--   * private.book_grams keeps, for each book, the pairs of characters (and
--     first characters, and single kanji) its title and author fold to, the
--     way the app lists a book (src/lib/search/postings.ts, bookGrams), with
--     the same folding (private.fold_book_loose is kanaFold,
--     private.drop_long_vowels is the step after it; fold_book_text is now
--     the two in turn, unchanged). A trigger keeps it as books are written.
--     Nobody reads it but the functions below: it would tell the title of a
--     book the reader may not see.
--   * The app sends the pairs each form of the query looks for and how many
--     are enough (queryGrams). private.found_book_ids takes the books that
--     hold every pair of a form first, and those sharing enough of them only
--     when too few hold them all (near titles), best first, tests each with
--     the same question the books' policy asks, keeps one book an edition
--     (the reader's own first), and stops at the number asked for.
--   * find_books then reads those books as the reader (security invoker),
--     under the books' policy, so nothing is shown that was not shown before.
--
-- Which feelings anyone kept (felt_in_town) read every record the reader may
-- see while a feeling was kept nowhere: about 12 seconds in a made-up town of
-- 50,000 records (AUD-006, 総点検 10-18). The policy is tested before a
-- filter on feelings, as @> is not leakproof, so no index helped. Now a
-- feeling's records are found by an index (private.felt_page, newest first,
-- a page at a time, ids only) and only those are read as the reader, until
-- one is seen; a feeling kept nowhere costs one look at the index. The books
-- felt with a chosen feeling are read the same way (feeling_records).
--
-- New: the table private.book_grams (no person's column; it goes with its
-- book), its index and trigger, an index on finished records' feelings, and
-- the functions. No row of any other table changes, and nothing is moved,
-- so nothing to copy (private.keep_copy) before it.
--
-- Rollback: a new migration with
--   drop function public.find_books(jsonb, text, text, integer);
--   drop function public.feeling_records(text, integer);
--   drop function private.found_book_ids(jsonb, text, text, integer);
--   drop function private.felt_page(text, timestamptz, uuid, integer);
--   drop trigger books_grams on public.books;
--   drop trigger books_grams_edited on public.books;
--   drop function private.keep_book_grams();
--   drop table private.book_grams;
--   drop function private.book_grams_of(text, text);
--   drop function private.search_grams(text[]);
--   drop function private.text_pairs(text);
--   drop index public.reading_entries_felt;
-- then the create function public.felt_in_town() of
-- 20261110000000_town_window.sql again (as create or replace), the create or
-- replace of fold_book_text of 20261111000000_fold_scripts.sql again, and
--   drop function private.drop_long_vowels(text);
--   drop function private.fold_book_loose(text);
-- An app that finds no find_books or feeling_records searches the town it
-- read, and reads a feeling's books as before.

create function private.fold_book_loose(t text) returns text
language plpgsql immutable set search_path = '' as $$
declare
  s text;
  c text;
  prior text := '';
  kept text := '';
  voiced text;
begin
  -- F1: NFKD, Latin marks removed, NFKC; ヴァ as ば; ゝ and ゞ written out.
  s := normalize(regexp_replace(normalize(coalesce(t, ''), nfkd), '[\u0300-\u036f]', '', 'g'), nfkc);
  s := regexp_replace(s, '[ヴゔ][ァぁ]', 'ば', 'g');
  s := regexp_replace(s, '[ヴゔ][ィぃ]', 'び', 'g');
  s := regexp_replace(s, '[ヴゔ][ェぇ]', 'べ', 'g');
  s := regexp_replace(s, '[ヴゔ][ォぉ]', 'ぼ', 'g');
  s := regexp_replace(s, '[ヴゔ][ュゅ]', 'びゅ', 'g');
  if s ~ '[ゝゞヽヾ]' then
    foreach c in array string_to_array(s, null) loop
      if prior <> '' and c in ('ゝ', 'ヽ') then
        c := prior;
      elsif prior <> '' and c in ('ゞ', 'ヾ') then
        voiced := normalize(prior || chr(12441), nfc);
        c := case when char_length(voiced) = 1 then voiced else prior end;
      end if;
      kept := kept || c;
      prior := c;
    end loop;
    s := kept;
  end if;
  -- F2: katakana, small kana, は→わ, A–Z, Greek and Cyrillic capitals and old
  -- kanji, in one pass (foldTable).
  -- F3: only digits, a–z, hiragana, 々〆, kanji and the letters of Greek,
  -- Cyrillic, Arabic, Thai and Hangul are kept, written by code point.
  s := regexp_replace(
    translate(s, 'ァアィイゥウェエォオカガキギクグケゲコゴサザシジスズセゼソゾタダチヂッツヅテデトドナニヌネノハバパヒビピフブプヘベペホボポマミムメモャヤュユョヨラリルレロヮワヰヱヲンヴヵヶぁぃぅぇぉっゃゅょゎゕゖはへをぢづゐゑゔABCDEFGHIJKLMNOPQRSTUVWXYZςӀΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩАБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯЀЁЂЃЄЅІЇЈЉЊЋЌЍЎЏѠѢѤѦѨѪѬѮѰѲѴѶѸѺѼѾҀҊҌҎҐҒҔҖҘҚҜҞҠҢҤҦҨҪҬҮҰҲҴҶҸҺҼҾӐӒӔӖӘӚӜӞӠӢӤӦӨӪӬӮӰӲӴӶӸӺӼӾӁӃӅӇӉӋӍ亞惡壓圍醫爲壹隱榮營衞驛圓鹽緣艷應歐毆櫻奧橫溫穩假價畫會繪壞懷槪擴殼覺學嶽樂渴罐卷陷勸寬關歡觀氣旣歸龜僞戲犧舊據擧虛峽挾狹鄕曉區驅勳薰徑莖惠揭溪經螢輕繼鷄藝擊缺硏縣儉劍險圈檢獻權顯驗嚴廣效恆黃鑛號國黑碎濟齋劑雜參棧蠶慘贊殘絲齒兒辭濕實寫釋壽收從澁獸縱肅處緖敍將稱涉燒證奬條狀乘淨剩疊繩壤孃讓釀觸囑眞寢愼盡圖粹醉穗隨髓樞數瀨聲齊靜竊攝專淺戰踐錢潛纖禪雙壯爭莊搜插巢曾瘦裝總騷增藏臟卽屬續墮對體帶滯臺瀧擇澤擔單膽團斷彈遲癡蟲晝鑄廳徵聽鎭轉傳燈當黨盜稻鬭鬪德獨讀屆貳惱腦霸拜廢賣麥發髮拔晚蠻祕濱濵甁拂佛倂竝餠邊邉變辨瓣辯步寶豐襃飜每萬滿麵默彌譯藥與豫餘譽搖樣謠來賴亂覽龍兩獵綠淚壘禮勵戾靈齡曆歷戀鍊爐勞郞樓錄灣內册敕壻尙悅敎沒淸點產稅脫舖遞鐵銳鄰隸靑顏飮吿刄囘姙强攜歲黏糺絕說鐮閱剝塡頰𠮟冱彥屢亙禱髙﨑嵜嶋嶌𠮷冨鷗遙禰晉堯槇瑤凜萠聰巖穰舘渕篭蠟曻姬祿驒檜舍戶吳娛繡囊', 'ああいいううええおおかがきぎくぐけげこごさざしじすずせぜそぞただちじつつずてでとどなにぬねのわばぱひびぴふぶぷえべぺほぼぽまみむめもややゆゆよよらりるれろわわいえおんぶかけあいうえおつやゆよわかけわえおじずいえぶabcdefghijklmnopqrstuvwxyzσӏαβγδεζηθικλμνξοπρστυφχψωабвгдежзийклмнопрстуфхцчшщъыьэюяѐёђѓєѕіїјљњћќѝўџѡѣѥѧѩѫѭѯѱѳѵѷѹѻѽѿҁҋҍҏґғҕҗҙқҝҟҡңҥҧҩҫҭүұҳҵҷҹһҽҿӑӓӕӗәӛӝӟӡӣӥӧөӫӭӯӱӳӵӷӹӻӽӿӂӄӆӈӊӌӎ亜悪圧囲医為壱隠栄営衛駅円塩縁艶応欧殴桜奥横温穏仮価画会絵壊懐概拡殻覚学岳楽渇缶巻陥勧寛関歓観気既帰亀偽戯犠旧拠挙虚峡挟狭郷暁区駆勲薫径茎恵掲渓経蛍軽継鶏芸撃欠研県倹剣険圏検献権顕験厳広効恒黄鉱号国黒砕済斎剤雑参桟蚕惨賛残糸歯児辞湿実写釈寿収従渋獣縦粛処緒叙将称渉焼証奨条状乗浄剰畳縄壌嬢譲醸触嘱真寝慎尽図粋酔穂随髄枢数瀬声斉静窃摂専浅戦践銭潜繊禅双壮争荘捜挿巣曽痩装総騒増蔵臓即属続堕対体帯滞台滝択沢担単胆団断弾遅痴虫昼鋳庁徴聴鎮転伝灯当党盗稲闘闘徳独読届弐悩脳覇拝廃売麦発髪抜晩蛮秘浜浜瓶払仏併並餅辺辺変弁弁弁歩宝豊褒翻毎万満麺黙弥訳薬与予余誉揺様謡来頼乱覧竜両猟緑涙塁礼励戻霊齢暦歴恋錬炉労郎楼録湾内冊勅婿尚悦教没清点産税脱舗逓鉄鋭隣隷青顔飲告刃回妊強携歳粘糾絶説鎌閲剥填頬叱冴彦屡亘祷高崎崎島島吉富鴎遥祢晋尭槙瑶凛萌聡巌穣館淵籠蝋昇姫禄騨桧舎戸呉娯繍嚢'),
    '[^0-9a-z\u3041-\u3096\u3005\u3006\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\U00020000-\U0002ffff\u0386-\u03ff\u0400-\u04ff\u0620-\u064a\u0660-\u0669\u066e-\u06d3\u0e01-\u0e4e\u0e50-\u0e59\u1100-\u11ff\uac00-\ud7a3]', '', 'g');
  return s;
end;
$$;
-- The step after fold_book_loose: a vowel that only lengthens the kana before
-- it goes (F4; dropLongVowels in src/lib/search/fold.ts).
create function private.drop_long_vowels(t text) returns text
language plpgsql immutable set search_path = '' as $$
declare
  c text;
  prior text := '';
  kept text := '';
begin
  foreach c in array string_to_array(coalesce(t, ''), null) loop
    if prior = '' or strpos(case c
        when 'あ' then 'あかさたなわまやらがざだばぱ'
        when 'い' then 'いきしちにひみりぎじびぴえけせてねめれげぜでべぺ'
        when 'う' then 'おこそとのほもよろごぞどぼぽうくすつぬふむゆるぐずぶぷ'
        when 'え' then 'えけせてねめれげぜでべぺ'
        when 'お' then 'おこそとのほもよろごぞどぼぽ'
        else '' end, prior) = 0 then
      kept := kept || c;
    end if;
    prior := c;
  end loop;
  return kept;
end;
$$;

-- The same folding as before, in its two steps.
create or replace function private.fold_book_text(t text) returns text
language sql immutable set search_path = '' as $$
  select private.drop_long_vowels(private.fold_book_loose(t))
$$;

-- Each pair of neighbouring characters; a text of one character is its own
-- (gramsOf).
create function private.text_pairs(t text) returns text[]
language sql immutable set search_path = '' as $$
  select case
    when char_length(coalesce(t, '')) = 0 then '{}'::text[]
    when char_length(t) = 1 then array[t]
    else array(
      select substr(t, i, 2) from generate_series(1, char_length(t) - 1) i
    )
  end
$$;

-- What a text is listed under (bookGrams): the pairs of it folded loosely
-- and folded, its first character, and each kanji, for the whole text and
-- for each part between marks and spaces, so a subtitle, or a second author,
-- is listed by its own start too. More than the app lists, never less: a
-- book the app would find shares at least as much with the query here.
create function private.search_grams(texts text[]) returns text[]
language plpgsql immutable set search_path = '' as $$
declare
  t text;
  piece text;
  loose text;
  key text;
  grams text[] := '{}';
begin
  foreach t in array coalesce(texts, '{}') loop
    continue when t is null or t = '';
    foreach piece in array array_prepend(t, regexp_split_to_array(t,
      '[\s:：;；/／、,，・()（）\[\]［］「」『』【】〈〉《》―─—〜~～\-‐－.。!！?？]+')) loop
      loose := private.fold_book_loose(piece);
      continue when loose = '';
      key := private.drop_long_vowels(loose);
      grams := grams || private.text_pairs(loose) || private.text_pairs(key)
        || ('^' || left(key, 1))
        || array(
          select ch from regexp_split_to_table(key, '') ch
          where ch ~ '[㐀-䶿一-鿿豈-﫿\U00020000-\U0002ffff]'
        );
    end loop;
  end loop;
  return array(select distinct g from unnest(grams) g where g <> '' and g <> '^' order by g);
end;
$$;

create function private.book_grams_of(title text, author text) returns text[]
language sql immutable set search_path = '' as $$
  select private.search_grams(array[title, author])
$$;

revoke all on function private.fold_book_loose(text), private.drop_long_vowels(text),
  private.text_pairs(text), private.search_grams(text[]),
  private.book_grams_of(text, text)
  from public, anon, authenticated;

create table private.book_grams (
  book_id uuid primary key references public.books (id) on delete cascade,
  grams text[] not null
);
alter table private.book_grams enable row level security;
revoke all on table private.book_grams from public, anon, authenticated;
create index book_grams_grams on private.book_grams using gin (grams);

create function private.keep_book_grams() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into private.book_grams (book_id, grams)
  values (new.id, private.book_grams_of(new.title, new.author))
  on conflict (book_id) do update set grams = excluded.grams;
  return null;
end;
$$;
revoke all on function private.keep_book_grams() from public, anon, authenticated;

create trigger books_grams after insert on public.books
  for each row execute function private.keep_book_grams();
create trigger books_grams_edited after update of title, author on public.books
  for each row
  when (old.title is distinct from new.title or old.author is distinct from new.author)
  execute function private.keep_book_grams();

insert into private.book_grams (book_id, grams)
select b.id, private.book_grams_of(b.title, b.author) from public.books b;

-- The books a query finds that the reader may read, best first, one an
-- edition, at most `wanted` (up to 200). `forms` is what the app's
-- queryGrams makes of each form of the query: [{"grams": [...], "need": n}].
-- A whole ISBN finds the books with it; the start of one, the books whose
-- ISBN begins so (as ISBN-13, or as ISBN-10 after 978).
--
-- Security definer, to look in book_grams; each book is then asked the
-- question the books' policy asks ("books are seen where they are used"),
-- and find_books reads the ids it gives as the reader, under that policy.
create function private.found_book_ids(
  forms jsonb,
  whole_isbn text,
  isbn_start text,
  wanted integer
) returns uuid[]
language plpgsql stable security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  most integer := least(greatest(coalesce(wanted, 0), 0), 200);
  asked jsonb := case when jsonb_typeof(forms) = 'array' then forms else '[]'::jsonb end;
  form jsonb;
  form_grams text[];
  all_grams text[] := '{}';
  hits uuid[] := '{}';
  -- At most this many books are scored for one query, however common its
  -- pairs: enough to hold the best of them in a town of many books.
  scored integer := 2000;
  kept uuid[] := '{}';
  editions uuid[] := '{}';
  candidate record;
begin
  if most = 0 then
    return kept;
  end if;

  if whole_isbn is not null and whole_isbn ~ '^[0-9]{12}[0-9X]$' then
    select coalesce(array_agg(b.id), '{}') into hits
    from (
      select b.id from public.books b where b.isbn = whole_isbn limit scored
    ) b;
  else
    if isbn_start is not null and isbn_start ~ '^[0-9]{5,12}$' then
      select coalesce(array_agg(b.id), '{}') into hits
      from (
        select b.id from public.books b
        where b.isbn like isbn_start || '%'
          or (char_length(isbn_start) <= 9 and b.isbn like '978' || isbn_start || '%')
        limit scored
      ) b;
    end if;
    -- The books holding every pair of a form, form by form.
    for form in select f from jsonb_array_elements(asked) f limit 20 loop
      form_grams := array(
        select g from jsonb_array_elements_text(
          case when jsonb_typeof(form -> 'grams') = 'array' then form -> 'grams' else '[]'::jsonb end
        ) g limit 200
      );
      continue when cardinality(form_grams) = 0;
      all_grams := all_grams || form_grams;
      hits := hits || array(
        select g.book_id from private.book_grams g
        where g.grams @> form_grams
        limit scored
      );
    end loop;
    -- Too few: the books sharing enough pairs with a form (near titles).
    if cardinality(hits) < most and cardinality(all_grams) > 0 then
      hits := hits || array(
        select g.book_id from private.book_grams g
        where g.grams && all_grams
          and exists (
            select 1 from jsonb_array_elements(asked) f
            where cardinality(array(
              select unnest(g.grams)
              intersect
              select jsonb_array_elements_text(f -> 'grams')
            )) >= greatest(coalesce((f ->> 'need')::integer, 1), 1)
          )
        limit scored
      );
    end if;
  end if;

  for candidate in
    select b.id, b.edition_id
    from public.books b
    left join private.book_grams g on g.book_id = b.id
    where b.id = any(hits)
    order by
      -- Most of a form's pairs held first; the reader's own, then a book
      -- from a catalog, then the oldest, among equals.
      coalesce((
        select max(
          cardinality(array(
            select unnest(g.grams)
            intersect
            select jsonb_array_elements_text(f -> 'grams')
          ))::numeric
          / greatest(jsonb_array_length(f -> 'grams'), 1)
        )
        from jsonb_array_elements(asked) f
        where jsonb_typeof(f -> 'grams') = 'array'
      ), 1) desc,
      (b.created_by = me) desc nulls last,
      (b.source <> 'manual') desc,
      b.created_at,
      b.id
  loop
    continue when candidate.edition_id = any(editions);
    -- The question of the policy "books are seen where they are used".
    continue when not exists (
      select 1 from public.books b
      where b.id = candidate.id
        and (
          b.source <> 'manual'
          or b.created_by = me
          or private.book_is_listed(b.id)
          or private.book_is_mine(b.id)
          or private.book_is_shared(b.id)
        )
    );
    kept := kept || candidate.id;
    editions := editions || candidate.edition_id;
    exit when cardinality(kept) >= most;
  end loop;
  return kept;
end;
$$;

-- The books a search finds (found_book_ids), read as the reader: the columns
-- town_books answers, in the order found.
create function public.find_books(
  forms jsonb,
  isbn text default null,
  isbn_start text default null,
  book_limit integer default 100
)
returns jsonb
language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', b.id, 'isbn', b.isbn, 'title', b.title, 'author', b.author,
    'publisher', b.publisher, 'price', b.price, 'source', b.source,
    'work_id', b.work_id, 'created_at', b.created_at, 'updated_at', b.updated_at
  ) order by found.place), '[]'::jsonb)
  from unnest(private.found_book_ids(
    find_books.forms, find_books.isbn, find_books.isbn_start, find_books.book_limit))
    with ordinality as found(id, place)
  join public.books b on b.id = found.id
$$;

-- Finished records felt with a feeling, newest first, a page at a time
-- after (before_at, before_id): their ids and times only. Security definer,
-- so the index on feelings is used before any policy; whoever asks reads
-- the records themselves as the reader.
create index reading_entries_felt on public.reading_entries
  using gin (feelings) where kind = 'finished';

create function private.felt_page(
  feeling text,
  before_at timestamptz,
  before_id uuid,
  size integer
)
returns table (id uuid, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select e.id, e.created_at from public.reading_entries e
  where e.kind = 'finished'
    and e.feelings @> array[feeling]
    and (before_at is null or (e.created_at, e.id) < (before_at, before_id))
  order by e.created_at desc, e.id desc
  limit least(greatest(size, 1), 500)
$$;

-- Which feelings anyone kept, in records the reader may see, of all time:
-- for each feeling, its records found by the index, a page at a time, until
-- one the reader may see.
create or replace function public.felt_in_town()
returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  every text[] := array[
    'cried', 'quiet', 'sleepless', 'warm', 'laughed', 'scared',
    'shaken', 'again', 'recommend', 'talk', 'lingering', 'not_now'
  ];
  feeling text;
  felt text[] := '{}';
  page uuid[];
  last_at timestamptz;
  last_id uuid;
begin
  foreach feeling in array every loop
    last_at := null;
    last_id := null;
    loop
      select array_agg(p.id order by p.created_at desc, p.id desc),
        (array_agg(p.created_at order by p.created_at desc, p.id desc))[count(*)::integer],
        (array_agg(p.id order by p.created_at desc, p.id desc))[count(*)::integer]
      into page, last_at, last_id
      from private.felt_page(feeling, last_at, last_id, 100) p;
      exit when page is null;
      if exists (select 1 from public.reading_entries e where e.id = any(page)) then
        felt := felt || feeling;
        exit;
      end if;
    end loop;
  end loop;
  return coalesce((
    select jsonb_agg(f order by place)
    from unnest(every) with ordinality as asked(f, place)
    where f = any(felt)
  ), '[]'::jsonb);
end
$$;

-- The newest finished records felt with a feeling that the reader may see,
-- at most record_limit (up to 500), without their words: the search's
-- books for that feeling.
create function public.feeling_records(feeling text, record_limit integer default 100)
returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  most integer := least(greatest(coalesce(record_limit, 0), 0), 500);
  kept jsonb := '[]'::jsonb;
  page uuid[];
  last_at timestamptz;
  last_id uuid;
begin
  if most = 0 or feeling is null then
    return kept;
  end if;
  loop
    select array_agg(p.id order by p.created_at desc, p.id desc),
      (array_agg(p.created_at order by p.created_at desc, p.id desc))[count(*)::integer],
      (array_agg(p.id order by p.created_at desc, p.id desc))[count(*)::integer]
    into page, last_at, last_id
    from private.felt_page(feeling, last_at, last_id, 100) p;
    exit when page is null;
    kept := kept || coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id, 'user_id', e.user_id, 'book_id', e.book_id, 'kind', e.kind,
        'feelings', e.feelings, 'spoiler', e.spoiler, 'is_public', e.is_public,
        'audience', e.audience, 'created_at', e.created_at,
        'updated_at', e.updated_at, 'body', ''
      ) order by e.created_at desc, e.id desc)
      from public.reading_entries e
      where e.id = any(page)
    ), '[]'::jsonb);
    exit when jsonb_array_length(kept) >= most;
  end loop;
  return coalesce((
    select jsonb_agg(r order by at) from jsonb_array_elements(kept)
      with ordinality as k(r, at)
    where at <= most
  ), '[]'::jsonb);
end
$$;

revoke all on function private.found_book_ids(jsonb, text, text, integer),
  private.felt_page(text, timestamptz, uuid, integer)
  from public, anon, authenticated;
grant execute on function private.found_book_ids(jsonb, text, text, integer),
  private.felt_page(text, timestamptz, uuid, integer)
  to anon, authenticated;
revoke all on function public.find_books(jsonb, text, text, integer),
  public.feeling_records(text, integer)
  from public, anon, authenticated;
grant execute on function public.find_books(jsonb, text, text, integer),
  public.feeling_records(text, integer)
  to anon, authenticated;
