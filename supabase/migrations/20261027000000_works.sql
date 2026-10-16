-- Works and editions (item 4 of the 2026-10-16 plan). Three things are kept
-- apart from now on (the owner's rule, 2026-10-16 13:07Z): a work, the text
-- itself; an edition, one ISBN, which is one printing of a work (a 文庫 and
-- its 単行本 are two editions of one work); and a registration, a row of
-- books, which is one reader's copy of an edition. A book without an ISBN,
-- typed in by hand, is an edition of its own. Reviews, posts, POPs and
-- posters meet at the work; a reader's own records, marks and shelves stay on
-- the registration they hold. A work is one volume: series and their volumes
-- (item 6) come above works later, so 上 and 下 are two works.
--
-- How books come together. The same ISBN is the same edition, always: a book
-- registered with an ISBN joins that edition, and so the edition's work, at
-- once. Registering never waits on anything and never compares titles or
-- authors, so nothing another reader registered, hidden or not, changes
-- what happens, and nothing tells a reader whether anyone else registered
-- that ISBN. ISBN-10s are stored as their ISBN-13 (the app turns them, and
-- isbn13_valid refuses anything else), so equal means equal. A reader who
-- edits a book's ISBN moves it to that edition. Two editions become one work
-- only when the operator joins them; work_candidates lists the editions
-- worth looking at, from the titles and authors anyone may read.
--
-- The operator joins works (join_works), undoes a join (undo_join), parts
-- editions out into a work of their own (part_books), and marks two works as
-- different (keep_apart). A join moves editions, so a book registered later
-- with any of their ISBNs joins the joined work too. Every join, undoing,
-- part and edited ISBN is written down (private.work_joins,
-- private.work_changes). The editions' own bibliographic data (title,
-- author, publisher, from openBD and the National Diet Library) comes in the
-- next step, filled in behind the scenes; registrations are then checked
-- against it, never against each other.
--
-- What moves: no row loses or changes anything. Every ISBN gets an edition
-- and a work, and every book without one a work of its own; whatever points
-- at a book (posts, marks, the library, encounters, records, reading, the
-- nine, posters, shops' shelves and scenes) reaches its work through it.
--
-- Who reads what: a book's work_id is read with the book. Works and editions
-- hold nothing of their own yet, and nobody reads them through the API.
-- Readers never name a work: books' column grants leave work_id out, and the
-- database fills it in.
--
-- The copy (moving_copies): books, and every table that points at a book,
-- so the check finds every row and link as it was. Nothing writes to them
-- until this file is done. docs/09「作品と版」has the steps and the undoing.
--
-- Rollback: until an app that reads work_id is live, a new migration undoes
-- this one with
--   drop trigger books_work on public.books;
--   drop trigger books_work_edited on public.books;
--   drop function private.book_work(), private.book_work_edited(),
--     private.edition_work(text), private.join_works(uuid, uuid),
--     private.undo_join(uuid), private.part_books(uuid[]),
--     private.keep_apart(uuid, uuid), private.work_candidates();
--   drop table private.works_apart, private.work_changes, private.work_joins;
--   drop trigger books_touch on public.books;
--   create trigger books_touch before update on public.books
--     for each row execute function public.touch_updated_at();
--   alter table public.books drop constraint books_isbn_fkey, drop column work_id;
--   drop table public.editions, public.works;
--   drop function private.titles_agree(text, text),
--     private.authors_agree(text[], text, text[], text),
--     private.title_numbers(text), private.author_keys(text),
--     private.fold_book_text(text);
--   revoke insert, update on public.books from authenticated;
--   grant insert, update on public.books to authenticated;

-- pnpm test:db runs exactly that, then drops the copy and runs this file
-- again. Once an app reads work_id, production has to go back to an app from
-- before it first: a town that asks for a column the database lacks does not
-- load. This file changes no book's own columns, and the check below makes
-- sure. Should they need putting back as the copy kept them, after the
-- rollback (the copy has no work_id, and a book needs one until then):
--   select * from private.restore_copy('20261027000000_works', array['public.books']::regclass[]);

-- Nobody reads or writes a book until this file is done, and the copy, the
-- works and the check all see the same books. The tables that point at books
-- are locked first: a reader writing one of them waits for books, so taking
-- books first could leave the two waiting on each other. In a DO block,
-- because supabase db push sends a file without BEGIN, and a bare LOCK is
-- refused outside a transaction block. The copy's own locks come after, so
-- this file never waits to raise a lock it holds.
select set_config('lock_timeout', '10s', true);
do $$
begin
  lock table public.book_encounters, public.book_marks, public.library_entries,
    public.library_shelf_books, public.poster_books, public.posts,
    public.profile_nine, public.reading_entries, public.reading_sessions
    in exclusive mode;
  lock table public.books in access exclusive mode;
end;
$$;

select private.keep_copy('20261027000000_works', array[
  'public.books',
  'public.book_encounters',
  'public.book_marks',
  'public.library_entries',
  'public.library_shelf_books',
  'public.poster_books',
  'public.posts',
  'public.profile_nine',
  'public.reading_entries',
  'public.reading_sessions'
]::regclass[]);

-- Telling titles and authors apart (for work_candidates only) --------------------

-- A title or an author as the search compares it (src/lib/search/fold.ts,
-- searchFold, step for step): width, case, kana, small kana, 旧字 and long
-- vowels set aside, spaces and punctuation dropped (森鷗外 and 森鴎外,
-- ノルウエイ and ノルウェイ, こゝろ and こころ, ＡＢＣ and abc).
-- tests/db-works.test.ts compares the two.
create function private.fold_book_text(t text) returns text
language plpgsql immutable set search_path = '' as $$
declare
  s text;
  c text;
  prior text := '';
  kept text := '';
  voiced text;
begin
  -- F1: NFKD, Latin marks removed, NFKC; ヴァ as ば; ゝ and ゞ written out.
  s := normalize(regexp_replace(normalize(coalesce(t, ''), nfkd), '[̀-ͯ]', '', 'g'), nfkc);
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
  -- F2: katakana, small kana, は→わ, A–Z and old kanji, in one pass (foldTable).
  -- F3: only digits, a–z, hiragana, 々〆 and kanji are kept.
  s := regexp_replace(
    translate(s, 'ァアィイゥウェエォオカガキギクグケゲコゴサザシジスズセゼソゾタダチヂッツヅテデトドナニヌネノハバパヒビピフブプヘベペホボポマミムメモャヤュユョヨラリルレロヮワヰヱヲンヴヵヶぁぃぅぇぉっゃゅょゎゕゖはへをぢづゐゑゔABCDEFGHIJKLMNOPQRSTUVWXYZ亞惡壓圍醫爲壹隱榮營衞驛圓鹽緣艷應歐毆櫻奧橫溫穩假價畫會繪壞懷槪擴殼覺學嶽樂渴罐卷陷勸寬關歡觀氣旣歸龜僞戲犧舊據擧虛峽挾狹鄕曉區驅勳薰徑莖惠揭溪經螢輕繼鷄藝擊缺硏縣儉劍險圈檢獻權顯驗嚴廣效恆黃鑛號國黑碎濟齋劑雜參棧蠶慘贊殘絲齒兒辭濕實寫釋壽收從澁獸縱肅處緖敍將稱涉燒證奬條狀乘淨剩疊繩壤孃讓釀觸囑眞寢愼盡圖粹醉穗隨髓樞數瀨聲齊靜竊攝專淺戰踐錢潛纖禪雙壯爭莊搜插巢曾瘦裝總騷增藏臟卽屬續墮對體帶滯臺瀧擇澤擔單膽團斷彈遲癡蟲晝鑄廳徵聽鎭轉傳燈當黨盜稻鬭鬪德獨讀屆貳惱腦霸拜廢賣麥發髮拔晚蠻祕濱濵甁拂佛倂竝餠邊邉變辨瓣辯步寶豐襃飜每萬滿麵默彌譯藥與豫餘譽搖樣謠來賴亂覽龍兩獵綠淚壘禮勵戾靈齡曆歷戀鍊爐勞郞樓錄灣內册敕壻尙悅敎沒淸點產稅脫舖遞鐵銳鄰隸靑顏飮吿刄囘姙强攜歲黏糺絕說鐮閱剝塡頰𠮟冱彥屢亙禱髙﨑嵜嶋嶌𠮷冨鷗遙禰晉堯槇瑤凜萠聰巖穰舘渕篭蠟曻姬祿驒檜舍戶吳娛繡囊', 'ああいいううええおおかがきぎくぐけげこごさざしじすずせぜそぞただちじつつずてでとどなにぬねのわばぱひびぴふぶぷえべぺほぼぽまみむめもややゆゆよよらりるれろわわいえおんぶかけあいうえおつやゆよわかけわえおじずいえぶabcdefghijklmnopqrstuvwxyz亜悪圧囲医為壱隠栄営衛駅円塩縁艶応欧殴桜奥横温穏仮価画会絵壊懐概拡殻覚学岳楽渇缶巻陥勧寛関歓観気既帰亀偽戯犠旧拠挙虚峡挟狭郷暁区駆勲薫径茎恵掲渓経蛍軽継鶏芸撃欠研県倹剣険圏検献権顕験厳広効恒黄鉱号国黒砕済斎剤雑参桟蚕惨賛残糸歯児辞湿実写釈寿収従渋獣縦粛処緒叙将称渉焼証奨条状乗浄剰畳縄壌嬢譲醸触嘱真寝慎尽図粋酔穂随髄枢数瀬声斉静窃摂専浅戦践銭潜繊禅双壮争荘捜挿巣曽痩装総騒増蔵臓即属続堕対体帯滞台滝択沢担単胆団断弾遅痴虫昼鋳庁徴聴鎮転伝灯当党盗稲闘闘徳独読届弐悩脳覇拝廃売麦発髪抜晩蛮秘浜浜瓶払仏併並餅辺辺変弁弁弁歩宝豊褒翻毎万満麺黙弥訳薬与予余誉揺様謡来頼乱覧竜両猟緑涙塁礼励戻霊齢暦歴恋錬炉労郎楼録湾内冊勅婿尚悦教没清点産税脱舗逓鉄鋭隣隷青顔飲告刃回妊強携歳粘糾絶説鎌閲剥填頬叱冴彦屡亘祷高崎崎島島吉富鴎遥祢晋尭槙瑶凛萌聡巌穣館淵籠蝋昇姫禄騨桧舎戸呉娯繍嚢'),
    '[^0-9a-zぁ-ゖ々〆㐀-䶿一-鿿豈-﫿\U00020000-\U0002ffff]', '', 'g');
  -- F4: a vowel that only lengthens the kana before it goes.
  kept := '';
  prior := '';
  foreach c in array string_to_array(s, null) loop
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
revoke all on function private.fold_book_text(text) from public, anon, authenticated;

-- The numbers in a folded title, in order: 進撃の巨人 1 and 12 are two
-- volumes, 華氏451度 and its 新訳版 one book.
create function private.title_numbers(folded text) returns text[]
language sql immutable set search_path = '' as $$
  select coalesce(array_agg(ltrim(m.found[1], '0') order by m.n), '{}')
  from regexp_matches(folded, '([0-9]+)', 'g') with ordinality m (found, n)
$$;
revoke all on function private.title_numbers(text) from public, anon, authenticated;

-- Whether two folded titles may name one work: the same, or one the start
-- of the other (華氏451度 and 華氏451度 新訳版) with the same numbers in both.
create function private.titles_agree(a text, b text) returns boolean
language sql immutable set search_path = '' as $$
  select a <> '' and b <> '' and (
    a = b
    or (least(char_length(a), char_length(b)) >= 2
      and (starts_with(a, b) or starts_with(b, a))
      and private.title_numbers(a) = private.title_numbers(b))
  )
$$;
revoke all on function private.titles_agree(text, text) from public, anon, authenticated;

-- The people in an author line, each folded (src/lib/search/title.ts,
-- splitAuthors): split on ; / and 、, without the roles written after a space
-- or in brackets (著, 訳, 解説…). A name written family, given with a comma
-- (ブラッドベリ, レイ) is one person read either way round; three parts, or a
-- part with a role (村上春樹, 柴田元幸 訳), are people of their own.
create function private.author_keys(author text) returns text[]
language plpgsql immutable set search_path = '' as $$
declare
  segment text;
  piece text;
  name text;
  names text[];
  roled boolean;
  keys text[] := '{}';
  roles constant text := '解説|校注|校訂|訳注|編集|翻訳|イラスト|作画|原案|構成|脚本|漫画|挿絵|装画|著者|編者|訳者|共著|原著|編著|監修|監訳|原作|写真|ほか訳|ほか|注|著|作|文|絵|訳|編|画|他';
begin
  foreach segment in array regexp_split_to_array(normalize(coalesce(author, ''), nfkc), '[;/、]') loop
    names := '{}';
    roled := false;
    foreach piece in array regexp_split_to_array(segment, ',') loop
      name := btrim(replace(piece, '[ほか]', ''));
      piece := name;
      for i in 1 .. 2 loop
        name := btrim(regexp_replace(name,
          '\s*[(\[](?:' || roles || ')[)\]]\s*$|\s+(?:' || roles || ')\s*$|^(?:' || roles || ')$', ''));
      end loop;
      roled := roled or name <> piece;
      name := private.fold_book_text(name);
      if name <> '' then
        names := names || name;
      end if;
    end loop;
    if cardinality(names) = 2 and not roled then
      keys := keys || (names[1] || names[2]) || (names[2] || names[1]);
    else
      keys := keys || names;
    end if;
  end loop;
  return keys;
end;
$$;
revoke all on function private.author_keys(text) from public, anon, authenticated;

-- Whether two author lines may name the same people: neither blank, and a
-- person in both, or one line, folded, inside the other (村上春樹 and
-- 村上春樹 著; never 村上春樹 and 村上龍, nor スティーヴン・キング and
-- ホーキング).
create function private.authors_agree(
  keys_a text[], folded_a text, keys_b text[], folded_b text
) returns boolean
language sql immutable set search_path = '' as $$
  select folded_a <> '' and folded_b <> '' and (
    keys_a && keys_b
    or (least(char_length(folded_a), char_length(folded_b)) >= 2
      and (strpos(folded_a, folded_b) > 0 or strpos(folded_b, folded_a) > 0))
  )
$$;
revoke all on function private.authors_agree(text[], text, text[], text)
  from public, anon, authenticated;

-- Works and editions ------------------------------------------------------------------

create table public.works (
  id uuid primary key default gen_random_uuid(),
  -- Set when the operator joined this work into another: its editions went
  -- there, and it stays, empty, so an id that named it still leads somewhere.
  merged_into uuid references public.works (id),
  created_at timestamptz not null default now(),
  constraint works_not_into_itself check (merged_into is distinct from id)
);
create index works_merged_into on public.works (merged_into) where merged_into is not null;
alter table public.works enable row level security;
revoke all on public.works from public, anon, authenticated;

-- One row for each ISBN any book has: the edition, and the work it belongs
-- to. Its bibliographic data comes in the next step.
create table public.editions (
  isbn text primary key check (public.isbn13_valid(isbn)),
  work_id uuid not null references public.works (id),
  created_at timestamptz not null default now()
);
create index editions_work on public.editions (work_id);
alter table public.editions enable row level security;
revoke all on public.editions from public, anon, authenticated;

alter table public.books add column work_id uuid;

-- A book's updated_at says when it was last changed as a book. Being moved
-- to another work (the move below, the operator's tools) is not that, so it
-- keeps its updated_at; an edited ISBN still counts, since books_touch fires
-- before books_work_edited moves the book.
drop trigger books_touch on public.books;
create trigger books_touch before update on public.books
  for each row when (old.work_id is not distinct from new.work_id)
  execute function public.touch_updated_at();

-- The operator's joins, with what each changed, so it can be undone exactly:
-- the editions that moved, and the works that had led to the one that went
-- (and now lead to the one that stayed).
create table private.work_joins (
  id uuid primary key default gen_random_uuid(),
  kept uuid not null references public.works (id),
  gone uuid not null references public.works (id),
  isbns text[] not null default '{}',
  led_here uuid[] not null default '{}',
  joined_at timestamptz not null default now(),
  undone_at timestamptz,
  check (kept <> gone)
);
alter table private.work_joins enable row level security;
revoke all on private.work_joins from public, anon, authenticated;

-- Every time a book changed works, and why: edited, its ISBN was changed (by
-- its reader, or by the operator correcting it); join and unjoin, the
-- operator's join and its undoing; part, the operator parted it out. A book
-- placed at registration has no row: its ISBN placed it.
create table private.work_changes (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books (id) on delete cascade,
  from_work uuid not null references public.works (id),
  to_work uuid not null references public.works (id),
  kind text not null check (kind in ('edited', 'join', 'unjoin', 'part')),
  join_id uuid references private.work_joins (id),
  changed_at timestamptz not null default now(),
  check ((kind in ('join', 'unjoin')) = (join_id is not null))
);
create index work_changes_book on private.work_changes (book_id);
create index work_changes_join on private.work_changes (join_id) where join_id is not null;
alter table private.work_changes enable row level security;
revoke all on private.work_changes from public, anon, authenticated;

-- Two works the operator found to be different, so the candidates leave
-- them out. One row a pair, the smaller id first. A row keeps the works it
-- was decided about; a work joined into another since is read as the one it
-- went into (merged_into), so the decision follows a join and its undoing
-- without the row changing.
create table private.works_apart (
  work_a uuid not null references public.works (id),
  work_b uuid not null references public.works (id),
  decided_at timestamptz not null default now(),
  primary key (work_a, work_b),
  check (work_a < work_b)
);
alter table private.works_apart enable row level security;
revoke all on private.works_apart from public, anon, authenticated;

-- The books there are now: an edition and a work for each ISBN, as old as
-- its oldest book, and a work for each book without one.
do $$
declare
  b record;
  made uuid;
begin
  for b in
    select isbn, min(created_at) as created_at from public.books
    where isbn is not null group by isbn order by isbn
  loop
    insert into public.works (created_at) values (b.created_at) returning id into made;
    insert into public.editions (isbn, work_id, created_at) values (b.isbn, made, b.created_at);
  end loop;
  update public.books k set work_id = e.work_id
  from public.editions e where e.isbn = k.isbn;
  for b in select id, created_at from public.books where isbn is null order by id loop
    insert into public.works (created_at) values (b.created_at) returning id into made;
    update public.books set work_id = made where id = b.id;
  end loop;
end;
$$;

-- A book is never without a work, nor an ISBN without its edition; a work
-- or an edition with books is never deleted (the operator's joins leave the
-- work, merged_into set).
alter table public.books
  alter column work_id set not null,
  add constraint books_work_id_fkey foreign key (work_id)
    references public.works (id) on delete restrict,
  add constraint books_isbn_fkey foreign key (isbn)
    references public.editions (isbn) on delete restrict;
create index books_work on public.books (work_id);

-- A new book's work ------------------------------------------------------------------

-- The work of the edition of this ISBN, made with its edition the first time
-- the ISBN is registered. Every registration of an ISBN takes the same lock
-- of that ISBN, whether its edition is there or not, so two first
-- registrations at once meet in one edition, and how long a registration
-- waits says nothing about whether anyone registered the ISBN before: a lock
-- taken only for a new ISBN would let a reader time it. The lock is the
-- ISBN's own, so a reader holding it holds up nobody else's books. A
-- statement of several books takes their locks one by one; should two meet
-- the same new ISBNs in the other order, Postgres ends one of them with a
-- deadlock, and the app sends it again.
-- Security definer: readers can neither read nor make editions and works.
create function private.edition_work(isbn text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  found_work uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('book-town.edition:' || edition_work.isbn, 0));
  select e.work_id into found_work from public.editions e where e.isbn = edition_work.isbn;
  if found then
    return found_work;
  end if;
  insert into public.works default values returning id into found_work;
  insert into public.editions (isbn, work_id) values (edition_work.isbn, found_work);
  return found_work;
end;
$$;
revoke all on function private.edition_work(text) from public, anon, authenticated;

-- Before a book is inserted, it is given its work: its edition's, or for a
-- book without an ISBN a work of its own. A book sent again (the app's
-- upsert passes over duplicates) meets its own row and is given that row's
-- work, so no work is made for nothing; two sends of one book at once wait
-- for each other, on a lock of that book's id alone. Whatever work_id an
-- insert names is replaced: only this decides a book's work. What it writes
-- is a work id, which shows nothing.
create function private.book_work() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  found_work uuid;
begin
  if new.isbn is not null then
    new.work_id := private.edition_work(new.isbn);
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('book-town.book:' || new.id::text, 0));
  select b.work_id into found_work from public.books b where b.id = new.id;
  if not found then
    insert into public.works default values returning id into found_work;
  end if;
  new.work_id := found_work;
  return new;
end;
$$;
revoke all on function private.book_work() from public, anon, authenticated;
create trigger books_work before insert on public.books
  for each row execute function private.book_work();

-- A book whose ISBN is changed goes to that edition's work, or, with its
-- ISBN taken off, to a work of its own; the move is written down.
create function private.book_work_edited() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  found_work uuid;
begin
  if new.isbn is not null then
    found_work := private.edition_work(new.isbn);
  else
    insert into public.works default values returning id into found_work;
  end if;
  if found_work <> old.work_id then
    insert into private.work_changes (book_id, from_work, to_work, kind)
    values (old.id, old.work_id, found_work, 'edited');
  end if;
  new.work_id := found_work;
  return new;
end;
$$;
revoke all on function private.book_work_edited() from public, anon, authenticated;
create trigger books_work_edited before update of isbn on public.books
  for each row when (old.isbn is distinct from new.isbn)
  execute function private.book_work_edited();

-- Readers write every column of a book they typed in as before, except its
-- work. A reader who sends a work_id is refused; the app never does.
revoke insert, update on public.books from authenticated;
grant insert (id, isbn, title, author, publisher, price, source, created_by,
  created_at, updated_at),
  update (id, isbn, title, author, publisher, price, source, created_by,
  created_at, updated_at)
  on public.books to authenticated;
grant select (work_id) on public.books to anon, authenticated;

-- The operator's tools ------------------------------------------------------------------
-- Run in the Supabase dashboard as the operator. They take books' ids, as
-- the operator finds books (select id, isbn, title, work_id from books
-- where …). Book ids never go in the public repository: a typed-in book's id
-- is what keeps it private (hide_registered_titles). Each locks books
-- against writes until it is done, so a book being registered meanwhile
-- lands in the work as it is after it. A book with an ISBN moves with its
-- whole edition, every registration of that ISBN.

-- Joins the work of goes_with into the work of stays_with: every edition and
-- book of the one moves to the other, with all that points at them. Returns
-- the join, for undo_join, and how many books moved.
--   select * from private.join_works('<a book of the work that stays>', '<a book of the work that goes>');
create function private.join_works(stays_with uuid, goes_with uuid)
returns table (join_id uuid, moved integer)
language plpgsql security definer set search_path = '' as $$
declare
  kept uuid;
  gone uuid;
  made uuid;
  n integer;
begin
  lock table public.books in share row exclusive mode;
  select b.work_id into kept from public.books b where b.id = stays_with;
  select b.work_id into gone from public.books b where b.id = goes_with;
  if kept is null or gone is null then
    raise exception 'no book has that id' using errcode = 'P0002';
  end if;
  if kept = gone then
    raise exception 'the two books are one work already';
  end if;
  insert into private.work_joins (kept, gone, isbns, led_here)
  values (kept, gone,
    array(select e.isbn from public.editions e where e.work_id = gone order by e.isbn),
    array(select w.id from public.works w where w.merged_into = gone order by w.id))
  returning id into made;
  insert into private.work_changes (book_id, from_work, to_work, kind, join_id)
  select b.id, gone, kept, 'join', made from public.books b where b.work_id = gone;
  update public.editions e set work_id = kept where e.work_id = gone;
  update public.books b set work_id = kept where b.work_id = gone;
  get diagnostics n = row_count;
  -- Works joined into the one that goes now lead to the one that stays, and
  -- so does what was decided about them (works_apart).
  update public.works w set merged_into = kept where w.id = gone or w.merged_into = gone;
  return query select made, n;
end;
$$;
revoke all on function private.join_works(uuid, uuid) from public, anon, authenticated;

-- Undoes a join exactly: the editions it moved go back, with every book of
-- their ISBNs still in the work that stayed (those registered since too),
-- and so do the books without an ISBN it moved; the works that led to the
-- one that went lead there again, and with them what was decided about
-- them. The two works are then kept apart. A join whose work was joined
-- into another since waits until that join is undone. Returns how many
-- books moved back.
--   select private.undo_join('<private.work_joins.id>');
create function private.undo_join(which uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  j private.work_joins%rowtype;
  n integer;
begin
  lock table public.books in share row exclusive mode;
  select * into j from private.work_joins x where x.id = which for update;
  if not found then
    raise exception 'no join has that id' using errcode = 'P0002';
  end if;
  if j.undone_at is not null then
    raise exception 'that join is undone already';
  end if;
  if exists (select 1 from public.works w where w.id = j.kept and w.merged_into is not null) then
    raise exception 'the work that stayed was joined into another since; undo that join first';
  end if;
  insert into private.work_changes (book_id, from_work, to_work, kind, join_id)
  select b.id, j.kept, j.gone, 'unjoin', j.id from public.books b
  where b.work_id = j.kept and (
    b.isbn = any (j.isbns)
    or (b.isbn is null and exists (
      select 1 from private.work_changes c
      where c.join_id = j.id and c.kind = 'join' and c.book_id = b.id)));
  update public.books b set work_id = j.gone
  where b.work_id = j.kept and (
    b.isbn = any (j.isbns)
    or (b.isbn is null and exists (
      select 1 from private.work_changes c
      where c.join_id = j.id and c.kind = 'join' and c.book_id = b.id)));
  get diagnostics n = row_count;
  update public.editions e set work_id = j.gone where e.work_id = j.kept and e.isbn = any (j.isbns);
  update public.works w set merged_into = null where w.id = j.gone;
  update public.works w set merged_into = j.gone
  where w.id = any (j.led_here) and w.merged_into = j.kept;
  insert into private.works_apart (work_a, work_b)
  values (least(j.kept, j.gone), greatest(j.kept, j.gone))
  on conflict do nothing;
  update private.work_joins x set undone_at = now() where x.id = j.id;
  return n;
end;
$$;
revoke all on function private.undo_join(uuid) from public, anon, authenticated;

-- Takes books out of their work into one new work of their own, with all
-- that points at them: the whole edition of each book with an ISBN, and each
-- book without one. They must all be in one work, and not all of it. The new
-- work is kept apart from the old, so the pair does not come back as a
-- candidate. Returns the new work. Undo: join_works again.
--   select private.part_books(array['<book>', '<book>']::uuid[]);
create function private.part_books(book_ids uuid[]) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  old uuid;
  fresh uuid;
  parting uuid[];
begin
  lock table public.books in share row exclusive mode;
  if coalesce(cardinality(book_ids), 0) = 0 then
    raise exception 'name the books to part';
  end if;
  if exists (
    select 1 from unnest(book_ids) given (id)
    where not exists (select 1 from public.books b where b.id = given.id)
  ) then
    raise exception 'no book has that id' using errcode = 'P0002';
  end if;
  if (select count(distinct b.work_id) from public.books b where b.id = any (book_ids)) > 1 then
    raise exception 'the books are in more than one work; part them one work at a time';
  end if;
  select b.work_id into old from public.books b where b.id = book_ids[1];
  parting := array(
    select b.id from public.books b
    where b.work_id = old and (
      b.id = any (book_ids)
      or b.isbn in (select x.isbn from public.books x where x.id = any (book_ids))));
  if not exists (
    select 1 from public.books b where b.work_id = old and b.id <> all (parting)
  ) then
    raise exception 'those are all the books of their work; nothing to part';
  end if;
  insert into public.works default values returning id into fresh;
  insert into private.work_changes (book_id, from_work, to_work, kind)
  select p.id, old, fresh, 'part' from unnest(parting) p (id);
  update public.editions e set work_id = fresh
  where e.work_id = old
    and e.isbn in (select x.isbn from public.books x where x.id = any (book_ids));
  update public.books b set work_id = fresh where b.id = any (parting);
  insert into private.works_apart (work_a, work_b)
  values (least(fresh, old), greatest(fresh, old));
  return fresh;
end;
$$;
revoke all on function private.part_books(uuid[]) from public, anon, authenticated;

-- Marks the works of two books as different works, so work_candidates
-- leaves the pair out. Undo: delete the row from private.works_apart.
--   select private.keep_apart('<book>', '<book>');
create function private.keep_apart(book_a uuid, book_b uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  a uuid;
  b uuid;
begin
  lock table public.books in share row exclusive mode;
  select x.work_id into a from public.books x where x.id = book_a;
  select x.work_id into b from public.books x where x.id = book_b;
  if a is null or b is null then
    raise exception 'no book has that id' using errcode = 'P0002';
  end if;
  if a = b then
    raise exception 'the two books are one work; part one out first';
  end if;
  insert into private.works_apart (work_a, work_b)
  values (least(a, b), greatest(a, b))
  on conflict do nothing;
end;
$$;
revoke all on function private.keep_apart(uuid, uuid) from public, anon, authenticated;

-- What the operator may look at: works that may be one, from the titles and
-- authors anyone may read (catalog rows, and typed-in books where they are
-- used in public), never from a book registered in private. A pair: titles
-- that agree (titles_agree), by authors that agree (authors_agree), neither
-- blank. Many works of one title and author come as one pair each beside the
-- one most touched, not every pair among them. Pairs kept apart are left out.
-- Those that touch the most come first: the readers with a public record
-- of either, the public reviews of either, and the open shops showing
-- either on a public shelf or in their scene, all of it what anyone may see
-- (never a library, a hidden post or anything else kept private). Nothing
-- is joined by it.
--   select * from private.work_candidates();
create function private.work_candidates()
returns table (
  book_a uuid,
  book_b uuid,
  title_a text,
  title_b text,
  author_a text,
  author_b text,
  isbn_a text,
  isbn_b text,
  readers bigint,
  reviews bigint,
  shops bigint
)
language sql stable security definer set search_path = '' as $$
  with seen as (
    select b.id, b.work_id,
      private.fold_book_text(b.title) as title_key,
      private.fold_book_text(b.author) as author_key,
      private.author_keys(b.author) as author_keys
    from public.books b
    where b.source <> 'manual' or private.book_is_listed(b.id)
  ),
  heads as (
    select distinct on (s.work_id, s.title_key, s.author_key) s.*
    from seen s
    where s.title_key <> '' and s.author_key <> ''
    order by s.work_id, s.title_key, s.author_key, s.id
  ),
  weight as (
    select w.work_id,
      (select count(distinct r.user_id) from public.reading_entries r
       join public.books e on e.id = r.book_id
       where e.work_id = w.work_id
         and r.is_public and not private.is_hidden('profile', r.user_id)) as readers,
      (select count(*) from public.posts p
       join public.books e on e.id = p.book_id
       where e.work_id = w.work_id
         and p.parent_id is null and p.reading_mode is distinct from 'solo'
         and not private.is_hidden('post', p.id)
         and not private.is_hidden('profile', p.author_id)) as reviews,
      (select count(*) from public.shops s
       where s.is_open
         and not private.is_hidden('shop', s.id)
         and not private.is_hidden('profile', s.owner_id)
         and exists (
           select 1 from public.books e
           where e.work_id = w.work_id
             and (s.public_scene_books @> jsonb_build_array(e.id::text)
               or s.public_shelves @> jsonb_build_array(jsonb_build_object(
                 'items', jsonb_build_array(jsonb_build_object('bookId', e.id::text)))))
         )) as shops
    from (select distinct h.work_id from heads h) w
  ),
  ranked as (
    select h.*, row_number() over (
      partition by h.title_key, h.author_key
      order by g.readers + g.reviews + g.shops desc, h.work_id) as place
    from heads h join weight g on g.work_id = h.work_id
  ),
  pairs as (
    -- The same title and author: each work beside the one most touched.
    select t.id as a_id, o.id as b_id, t.work_id as a_work, o.work_id as b_work
    from ranked t
    join ranked o on o.title_key = t.title_key and o.author_key = t.author_key and o.place > 1
    where t.place = 1
    union all
    -- Written differently but agreeing: the most touched work of each.
    select a.id, b.id, a.work_id, b.work_id
    from ranked a
    join ranked b on left(b.title_key, 2) = left(a.title_key, 2)
      and (b.title_key, b.author_key) > (a.title_key, a.author_key)
    where a.place = 1 and b.place = 1
      and private.titles_agree(a.title_key, b.title_key)
      and private.authors_agree(a.author_keys, a.author_key, b.author_keys, b.author_key)
  ),
  -- Pairs kept apart, as the works they are now.
  apart as (
    select
      least(coalesce(wa.merged_into, wa.id), coalesce(wb.merged_into, wb.id)) as work_a,
      greatest(coalesce(wa.merged_into, wa.id), coalesce(wb.merged_into, wb.id)) as work_b
    from private.works_apart x
    join public.works wa on wa.id = x.work_a
    join public.works wb on wb.id = x.work_b
  ),
  chosen as (
    select distinct on (least(p.a_work, p.b_work), greatest(p.a_work, p.b_work)) p.*
    from pairs p
    where p.a_work <> p.b_work and not exists (
      select 1 from apart x
      where x.work_a = least(p.a_work, p.b_work) and x.work_b = greatest(p.a_work, p.b_work)
    )
    order by least(p.a_work, p.b_work), greatest(p.a_work, p.b_work), p.a_id, p.b_id
  )
  select a.id, b.id, a.title, b.title, a.author, b.author, a.isbn, b.isbn,
    ga.readers + gb.readers, ga.reviews + gb.reviews, ga.shops + gb.shops
  from chosen c
  join public.books a on a.id = c.a_id
  join public.books b on b.id = c.b_id
  join weight ga on ga.work_id = c.a_work
  join weight gb on gb.work_id = c.b_work
  order by ga.readers + gb.readers + ga.reviews + gb.reviews + ga.shops + gb.shops desc,
    a.id, b.id
$$;
revoke all on function private.work_candidates() from public, anon, authenticated;

-- The check ---------------------------------------------------------------------------

-- Besides check_copy's rows and links: every book kept its own columns,
-- books share a work exactly when they share an ISBN (a book without one is
-- alone in its work), each ISBN book is in
-- its edition's work, and every work has a book. Counts only in the
-- messages: they land in public Actions logs.
do $$
declare
  copy_table text;
  changed bigint;
begin
  select c.copy_name into copy_table from keep.copies c
  where c.label = '20261027000000_works' and c.source = 'public.books';
  execute format(
    'select count(*) from keep.%I c join public.books b on b.id = c.id
     where to_jsonb(b) - ''work_id'' is distinct from to_jsonb(c) - ''keep_owners''',
    copy_table) into changed;
  if changed > 0 then
    raise exception 'the move changed % books', changed;
  end if;
  select count(*) into changed from (
    select b.work_id from public.books b
    group by b.work_id having count(distinct coalesce(b.isbn, b.id::text)) > 1
  ) x;
  if changed > 0 then
    raise exception '% works hold books of more than one ISBN', changed;
  end if;
  select count(*) into changed from (
    select b.isbn from public.books b where b.isbn is not null
    group by b.isbn having count(distinct b.work_id) > 1
  ) x;
  if changed > 0 then
    raise exception '% ISBNs are in more than one work', changed;
  end if;
  select count(*) into changed from public.books b join public.editions e on e.isbn = b.isbn
  where e.work_id <> b.work_id;
  if changed > 0 then
    raise exception '% books are not in their edition''s work', changed;
  end if;
  select count(*) into changed from public.works w
  where not exists (select 1 from public.books b where b.work_id = w.id);
  if changed > 0 then
    raise exception '% works have no book', changed;
  end if;
end;
$$;

select private.check_copy('20261027000000_works');
