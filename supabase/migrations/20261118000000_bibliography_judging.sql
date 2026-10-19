-- Judging again, more carefully (item 4 of the 2026-10-16 plan, its rest;
-- AUD-013, 014, 087, 088 and 092 of the 2026-10-17 audit). What a
-- reader typed for a book is compared with the master as before
-- (20261102000000_bibliography_holds.sql), with these differences:
--
--   * Volumes are read the way the app reads them (src/lib/search/volume.ts
--     and title.ts, the same examples in tests/fixtures/volumes.ts): 巻1,
--     1巻, 第1巻, 第2部, BOOK2, Vol.3, 前編・後編, Roman numerals, a number
--     straight after kana or kanji (進撃の巨人2) but not after a letter
--     (1Q84), one volume a title, the edition taken off first (罪と罰 上
--     (新潮文庫)). The master's volume is read from its start (第1部
--     泥棒かささぎ編 is 1), else from the library's reading of it (ジョウ is
--     上), which ndl_answer now keeps (volume_reading).
--   * An author agreeing makes a book close only when its title shares a run
--     of letters with the master's (a third of the shorter, two at least),
--     or cannot be compared with it (written in another script, or no letter
--     typed). Another book by the same writer is held, to be asked once
--     (けにーさん, 2026-10-19 06:33Z: 「聞く」).
--   * The library's other titles (dcndl:alternative, 原タイトル in its
--     description) are compared too, and so is a title typed in romaji with
--     the title's reading and an author typed in romaji with the creators'
--     readings, either way round (Haruki Murakami is むらかみはるき): an
--     English title or a romaji name does not hold the right book. ndl_answer
--     keeps the other titles (alternatives); the records kept are read again
--     for them here.
--   * A book held stays in its edition's work; its reader is told as before
--     (the notice and the box on its page). The work's page and candidates
--     leave it out as before (book_counts_in_work). A held book that had been
--     moved to a work of its own goes back, written down as the reader's
--     answer is.
--   * book_holds tells when the book was placed, so the notice can say it is
--     a book registered before (held a day or more after it was placed: the
--     sources answered late).
--
-- Every book with an ISBN its reader has not confirmed is compared again on
-- the next ticks, three hundred a tick (67 books in production, 43 of them
-- with an ISBN). A verdict that stays the same changes nothing; a book newly
-- held is told to its reader as a book registered before.
--
-- Before that, the books, their checks and the editions' sources are copied
-- (private.keep_copy): the checks' copy brings the verdicts back.
--
-- Rollback: a new migration with
--   drop function private.bib_verdict(text, text, text, text, text, text, jsonb, jsonb, text),
--     private.bib_compared(uuid, timestamptz, jsonb), private.bib_overlap(text, text),
--     private.bib_scripts(text), private.bib_romaji_names(text), private.bib_romaji(text),
--     private.bib_title_volume(text), private.bib_volume_end(text),
--     private.bib_volume_start(text), private.bib_volume_heard(text), private.ndl_more(xml);
--   drop function public.book_holds();
--   update private.edition_sources set fields = fields - 'alternatives' - 'volume_reading'
--   where source = 'ndl';
--   select private.restore_copy('20261118000000_bibliography_judging',
--     array['private.book_checks']::regclass[], false);
-- and then makes private.bib_number(text), private.bib_volume(text),
-- private.bib_verdict(text, text, text, text, text, text, jsonb),
-- private.bib_judge(), public.confirm_book_isbn(uuid), private.release_hold(uuid)
-- and public.book_holds() again as 20261102000000_bibliography_holds.sql has
-- them, and private.ndl_answer(text, text) as 20261101000000_bibliography.sql
-- has it, each with its revoke (and confirm_book_isbn's and book_holds'
-- grants). pnpm test:db runs exactly that. The verdicts come back from the
-- copy (books placed since keep theirs); a book held now stays in its
-- edition's work, as the functions of before leave it.

-- Nobody writes a book, an edition's sources or a book's checks until this
-- file is done (keep_copy holds them, in the order a registration takes
-- them).
select private.keep_copy('20261118000000_bibliography_judging',
  array['public.books', 'private.edition_sources', 'private.book_checks']::regclass[]);

-- Volumes -----------------------------------------------------------------------------

-- A volume's number as the judging compares it: in figures without leading
-- zeros (02 is 2), in kanji up to 九十九, in Roman numerals up to XXXIX
-- (written in capitals), or 上・中・下 as they are. Not a year (four figures
-- or more), nor anything else.
create or replace function private.bib_number(k text) returns text
language plpgsql immutable set search_path = '' as $$
declare
  m text[];
  digits constant text := '一二三四五六七八九';
  total integer := 0;
  here integer;
  after integer;
begin
  if k ~ '^[0-9]{1,3}$' then
    return coalesce(nullif(ltrim(k, '0'), ''), '0');
  elsif k ~ '^[上中下]$' then
    return k;
  elsif k ~ '^X{0,3}(IX|IV|V?I{0,3})$' and k <> '' then
    for i in 1 .. char_length(k) loop
      here := case substr(k, i, 1) when 'I' then 1 when 'V' then 5 else 10 end;
      after := case substr(k, i + 1, 1) when 'I' then 1 when 'V' then 5 when 'X' then 10
        else 0 end;
      total := total + case when here < after then -here else here end;
    end loop;
    return total::text;
  end if;
  m := regexp_match(coalesce(k, ''), '^([一二三四五六七八九]?)(十?)([一二三四五六七八九]?)$');
  if m is null or k = '' then
    return null;
  elsif m[2] = '' then
    return case when char_length(k) = 1 then strpos(digits, k)::text end;
  end if;
  return (coalesce(nullif(strpos(digits, nullif(m[1], '')), 0), 1) * 10
    + coalesce(strpos(digits, nullif(m[3], '')), 0))::text;
end;
$$;
revoke all on function private.bib_number(text) from public, anon, authenticated;

-- The volume at the end of a text and the text before it, without the
-- spaces, brackets and dots between (volumeAtEnd in src/lib/search/volume.ts,
-- line for line): null when it ends in none. The text before may be empty
-- (第2巻, 上).
create function private.bib_volume_end(t text, out before text, out mark text)
language plpgsql immutable set search_path = '' as $$
declare
  rest text := regexp_replace(normalize(coalesce(t, ''), nfkc), '[[:space:])\]}」』】〕〉》]+$', '');
  num constant text := '[0-9]+|[一二三四五六七八九十]+|[IVXivx]+';
  sep constant text := '[[:space:](\[{「『【〔〈《.,、。・:;~〜/‐−―─—-]';
  m text[];
  prev text;
  kind text;
begin
  -- 第 or 巻 before the number: 第2巻, 巻1, 第2部.
  m := regexp_match(rest, '((?:第|巻)\s*(' || num || ')\s*(?:巻|部|集|編|篇)?)$');
  if m is not null then
    mark := private.bib_number(upper(m[2]));
    if mark is not null then
      before := regexp_replace(left(rest, char_length(rest) - char_length(m[1])), sep || '+$', '');
      return;
    end if;
  end if;
  -- vol, volume, book, part, no. or # before it, not inside a word
  -- (Facebook 2 is 2 of Facebook).
  m := regexp_match(rest, '((?:vol\.?|volume|book|part|no\.|#)\s*(' || num || '))$', 'i');
  if m is not null
      and right(left(rest, char_length(rest) - char_length(m[1])), 1) !~ '[A-Za-z0-9]' then
    mark := private.bib_number(upper(m[2]));
    if mark is not null then
      before := regexp_replace(left(rest, char_length(rest) - char_length(m[1])), sep || '+$', '');
      return;
    end if;
  end if;
  -- 巻, 部, 集, 編 or 篇 after it: 2巻, 二十三巻 (kanji after a space).
  m := regexp_match(rest, '((' || num || ')\s*(?:巻|部|集|編|篇))$');
  if m is not null then
    prev := right(left(rest, char_length(rest) - char_length(m[1])), 1);
    kind := case when m[2] ~ '^[0-9]' then 'figures' when m[2] ~ '^[IVXivx]' then 'roman'
      else 'kanji' end;
    if (kind = 'figures' and prev !~ '[A-Za-z]') or (kind <> 'figures' and (prev = '' or prev ~ sep)) then
      mark := private.bib_number(upper(m[2]));
      if mark is not null then
        before := regexp_replace(left(rest, char_length(rest) - char_length(m[1])), sep || '+$', '');
        return;
      end if;
    end if;
  end if;
  -- 上巻, 前編 and the like, anywhere; 上, 中, 下 alone after a space.
  m := regexp_match(rest, '((上巻|中巻|下巻|前編|後編|前篇|後篇))$');
  if m is not null and right(left(rest, char_length(rest) - char_length(m[1])), 1) !~ '[上中下]' then
    mark := case when m[2] in ('上巻', '前編', '前篇') then '上' when m[2] = '中巻' then '中'
      else '下' end;
    before := regexp_replace(left(rest, char_length(rest) - char_length(m[1])), sep || '+$', '');
    return;
  end if;
  m := regexp_match(rest, '((上|中|下|中編|中篇))$');
  if m is not null then
    prev := right(left(rest, char_length(rest) - char_length(m[1])), 1);
    if prev = '' or prev ~ sep then
      mark := case when m[2] = '上' then '上' when m[2] = '下' then '下' else '中' end;
      before := regexp_replace(left(rest, char_length(rest) - char_length(m[1])), sep || '+$', '');
      return;
    end if;
  end if;
  -- A number alone: figures after anything but a letter, kanji and Roman
  -- numerals (in capitals) after a space or a bracket.
  m := regexp_match(rest, '((' || num || '))$');
  if m is not null then
    prev := right(left(rest, char_length(rest) - char_length(m[1])), 1);
    kind := case when m[2] ~ '^[0-9]' then 'figures' when m[2] ~ '^[IVXivx]' then 'roman'
      else 'kanji' end;
    if (kind = 'figures' and prev !~ '[A-Za-z]')
        or (kind = 'kanji' and (prev = '' or prev ~ sep))
        or (kind = 'roman' and m[2] ~ '^[IVX]+$' and (prev = '' or prev ~ sep)) then
      mark := private.bib_number(m[2]);
      if mark is not null then
        before := regexp_replace(left(rest, char_length(rest) - char_length(m[1])), sep || '+$', '');
      end if;
    end if;
  end if;
end;
$$;
revoke all on function private.bib_volume_end(text) from public, anon, authenticated;

-- A title without the edition and the volume at its end, and the volume's
-- mark (null for none): 罪と罰 上 (新潮文庫) is 罪と罰 and 上, ゴルゴ13 2 is
-- ゴルゴ13 and 2 (one volume a title). As the app reads it (titleVolume in
-- src/lib/search/title.ts).
create function private.bib_title_volume(t text, out rest text, out mark text)
language plpgsql immutable set search_path = '' as $$
declare
  edition constant text := '新装版|増補改訂版|改訂新版|改訂版|増補版|決定版|完全版|愛蔵版|普及版|新訳版|文庫版|特装版|限定版';
  spaced constant text := '新版|改版|新訳';
  series constant text := '文庫|新書|選書|叢書|シリーズ|全集|ライブラリ';
  opening constant text := '(\[［【〈《〔「『';
  closing constant text := ')\]］】〉》〕」』';
  at_end text := '(\s*(?:[' || opening || '][^' || opening || closing || ']*(?:' || edition
    || '|' || spaced || '|' || series || ')[^' || opening || closing || ']*[' || closing
    || ']|(?:' || edition || ')|\s(?:' || spaced || '))\s*)$';
  before text;
  m text[];
  v record;
begin
  rest := regexp_replace(normalize(coalesce(t, ''), nfkc), '^[[:space:]]+|[[:space:]]+$', '', 'g');
  for pass in 1 .. 3 loop
    before := rest;
    m := regexp_match(rest, at_end);
    if m is not null and char_length(m[1]) < char_length(rest) then
      rest := regexp_replace(left(rest, char_length(rest) - char_length(m[1])),
        '^[[:space:]]+|[[:space:]]+$', '', 'g');
    end if;
    if mark is null then
      select * into v from private.bib_volume_end(rest);
      if v.mark is not null
          and regexp_replace(v.before, '^[[:space:]]+|[[:space:]]+$', '', 'g') <> '' then
        mark := v.mark;
        rest := regexp_replace(v.before, '^[[:space:]]+|[[:space:]]+$', '', 'g');
      end if;
    end if;
    exit when rest = before;
  end loop;
end;
$$;
revoke all on function private.bib_title_volume(text) from public, anon, authenticated;

-- As before, read as the app reads it: the volume at the end of a title and
-- the title before it, as a key; base and mark are null when it names none.
create or replace function private.bib_volume(t text, out base text, out mark text)
language plpgsql immutable set search_path = '' as $$
declare
  v record;
begin
  select * into v from private.bib_title_volume(t);
  if v.mark is not null then
    mark := v.mark;
    base := private.bib_key(v.rest);
  end if;
end;
$$;
revoke all on function private.bib_volume(text) from public, anon, authenticated;

-- The master's volume, read from its start: 巻1, 第1部 泥棒かささぎ編,
-- BOOK1 4月-6月, 上, 2 (完結). Null when it starts with none (別巻, 2000).
create function private.bib_volume_start(v text) returns text
language plpgsql immutable set search_path = '' as $$
declare
  s text := regexp_replace(normalize(coalesce(v, ''), nfkc), '^[[:space:]]+', '');
  num constant text := '[0-9]+|[一二三四五六七八九十]+|[IVXivx]+';
  ends constant text := '^($|[[:space:](\[{「『【〔〈《.,、。・:;~〜/‐−―─—)\]}」』】〕〉》-])';
  m text[];
begin
  m := regexp_match(s, '^(?:第|巻)\s*(' || num || ')\s*(?:巻|部|集|編|篇)?(.?)');
  if m is not null and m[2] !~ '^[0-9A-Za-z]' and private.bib_number(upper(m[1])) is not null then
    return private.bib_number(upper(m[1]));
  end if;
  m := regexp_match(s, '^(?:vol\.?|volume|book|part|no\.|#)\s*(' || num || ')(.?)', 'i');
  if m is not null and m[2] !~ '^[0-9A-Za-z]' and private.bib_number(upper(m[1])) is not null then
    return private.bib_number(upper(m[1]));
  end if;
  m := regexp_match(s, '^(上巻|中巻|下巻|前編|中編|後編|前篇|中篇|後篇|上|中|下)(.?)');
  if m is not null and m[2] ~ ends then
    return case when m[1] in ('上', '上巻', '前編', '前篇') then '上'
      when m[1] in ('中', '中巻', '中編', '中篇') then '中' else '下' end;
  end if;
  m := regexp_match(s, '^(' || num || ')\s*(?:巻|部|集|編|篇)(.?)');
  if m is not null and m[2] !~ '^[0-9A-Za-z]' and private.bib_number(upper(m[1])) is not null then
    return private.bib_number(upper(m[1]));
  end if;
  m := regexp_match(s, '^(' || num || ')(.?)');
  if m is not null and m[2] ~ ends and (m[1] !~ '^[IVXivx]' or m[1] ~ '^[IVX]+$') then
    return private.bib_number(m[1]);
  end if;
  return null;
end;
$$;
revoke all on function private.bib_volume_start(text) from public, anon, authenticated;

-- The library's reading of a volume (dcndl:transcription: 1, ジョウ, ゲ,
-- ダイ2カン), when the volume itself reads as none.
create function private.bib_volume_heard(r text) returns text
language sql immutable set search_path = '' as $$
  select case
    when s ~ '^(ダイ)?[0-9]{1,3}($|[^0-9])'
      then private.bib_number(substring(s from '^(?:ダイ)?([0-9]{1,3})'))
    when s ~ '^(ジョウ|ゼンペン)' then '上'
    when s ~ '^チュウ' then '中'
    when s ~ '^(ゲ|コウヘン)' then '下'
  end
  from (select regexp_replace(normalize(coalesce(r, ''), nfkc), '[[:space:]]', '', 'g') as s) x
$$;
revoke all on function private.bib_volume_heard(text) from public, anon, authenticated;

-- Romaji, other titles, and how titles overlap --------------------------------------------

-- A text written in romaji, as kana (romajiToKana in src/lib/search/romaji.ts,
-- line for line, and its table): null when it is not romaji, or ends in a
-- syllable not finished (SF, 1Q84, English words).
create function private.bib_romaji(t text) returns text
language plpgsql immutable set search_path = '' as $$
declare
  s text := replace(regexp_replace(lower(regexp_replace(normalize(coalesce(t, ''), nfkd),
    '[̀-ͯ]', '', 'g')), '[[:space:]・-]+', '', 'g'), '’', '''');
  syllables constant jsonb := '{"a":"あ","ba":"ば","be":"べ","bi":"び","bo":"ぼ","bu":"ぶ","bya":"びゃ","byo":"びょ","byu":"びゅ","cha":"ちゃ","che":"ちぇ","chi":"ち","cho":"ちょ","chu":"ちゅ","cya":"ちゃ","cyo":"ちょ","cyu":"ちゅ","da":"だ","de":"で","dhi":"でぃ","di":"ぢ","do":"ど","du":"づ","dya":"ぢゃ","dyo":"ぢょ","dyu":"ぢゅ","e":"え","fa":"ふぁ","fe":"ふぇ","fi":"ふぃ","fo":"ふぉ","fu":"ふ","ga":"が","ge":"げ","gi":"ぎ","go":"ご","gu":"ぐ","gya":"ぎゃ","gyo":"ぎょ","gyu":"ぎゅ","ha":"は","he":"へ","hi":"ひ","ho":"ほ","hu":"ふ","hya":"ひゃ","hyo":"ひょ","hyu":"ひゅ","i":"い","ja":"じゃ","je":"じぇ","ji":"じ","jo":"じょ","ju":"じゅ","jya":"じゃ","jyo":"じょ","jyu":"じゅ","ka":"か","ke":"け","ki":"き","ko":"こ","ku":"く","kya":"きゃ","kyo":"きょ","kyu":"きゅ","la":"ら","le":"れ","li":"り","lo":"ろ","lu":"る","lya":"りゃ","lyo":"りょ","lyu":"りゅ","ma":"ま","me":"め","mi":"み","mo":"も","mu":"む","mya":"みゃ","myo":"みょ","myu":"みゅ","na":"な","ne":"ね","ni":"に","no":"の","nu":"ぬ","nya":"にゃ","nyo":"にょ","nyu":"にゅ","o":"お","pa":"ぱ","pe":"ぺ","pi":"ぴ","po":"ぽ","pu":"ぷ","pya":"ぴゃ","pyo":"ぴょ","pyu":"ぴゅ","ra":"ら","re":"れ","ri":"り","ro":"ろ","ru":"る","rya":"りゃ","ryo":"りょ","ryu":"りゅ","sa":"さ","se":"せ","sha":"しゃ","she":"しぇ","shi":"し","sho":"しょ","shu":"しゅ","si":"し","so":"そ","su":"す","sya":"しゃ","syo":"しょ","syu":"しゅ","ta":"た","te":"て","thi":"てぃ","ti":"ち","to":"と","tsu":"つ","tu":"つ","tya":"ちゃ","tyo":"ちょ","tyu":"ちゅ","u":"う","va":"ゔぁ","ve":"ゔぇ","vi":"ゔぃ","vo":"ゔぉ","vu":"ゔ","wa":"わ","we":"うぇ","wi":"うぃ","wo":"を","ya":"や","ye":"いぇ","yo":"よ","yu":"ゆ","za":"ざ","ze":"ぜ","zi":"じ","zo":"ぞ","zu":"ず","zya":"じゃ","zyo":"じょ","zyu":"じゅ"}';
  kana text := '';
  i integer := 1;
  c text;
  nx text;
  part text;
begin
  if s !~ '^[a-z'']+$' or s !~ '[aiueo]' then
    return null;
  end if;
  while i <= char_length(s) loop
    c := substr(s, i, 1);
    nx := substr(s, i + 1, 1);
    if c = '''' then
      i := i + 1;
      continue;
    end if;
    -- nn, n' and n before a consonant or at the end are ん.
    if c = 'n' and nx !~ '[aiueoy]' then
      kana := kana || 'ん';
      i := i + case when nx = 'n' and substr(s, i + 2, 1) !~ '[aiueoy]' then 2 else 1 end;
      continue;
    end if;
    if c = 'm' and nx ~ '[bmp]' then
      kana := kana || 'ん';
      i := i + 1;
      continue;
    end if;
    if (c = nx and c ~ '[bcdfghjkpqrstvwxz]') or (c = 't' and nx = 'c') then
      kana := kana || 'っ';
      i := i + 1;
      continue;
    end if;
    part := case
      when syllables ? substr(s, i, 3) then substr(s, i, 3)
      when syllables ? substr(s, i, 2) then substr(s, i, 2)
      when syllables ? substr(s, i, 1) then substr(s, i, 1)
    end;
    if part is null then
      return null;
    end if;
    kana := kana || (syllables ->> part);
    i := i + char_length(part);
  end loop;
  return kana;
end;
$$;
revoke all on function private.bib_romaji(text) from public, anon, authenticated;

-- The people of an author line written in romaji, each as kana either way
-- round and folded (Haruki Murakami and Murakami, Haruki are both
-- はるきむらかみ and むらかみはるき): for comparing with the creators'
-- readings. A person with a word that is not romaji, or more than four
-- words, is left out.
create function private.bib_romaji_names(author text) returns text[]
language plpgsql immutable set search_path = '' as $$
declare
  segment text;
  words text[];
  word text;
  kana text[];
  one text;
  names text[] := '{}';
begin
  foreach segment in array regexp_split_to_array(normalize(coalesce(author, ''), nfkc),
      '[;/、&]|\s+and\s+') loop
    segment := btrim(regexp_replace(segment, '[(\[][^)\]]*[)\]]', ' ', 'g'));
    words := case when strpos(segment, ',') > 0
      then regexp_split_to_array(segment, '\s*,\s*')
      else regexp_split_to_array(segment, '\s+') end;
    continue when segment = '' or cardinality(words) > 4;
    kana := '{}';
    foreach word in array words loop
      one := private.bib_romaji(word);
      exit when one is null;
      kana := kana || one;
    end loop;
    continue when cardinality(kana) <> cardinality(words);
    names := names || private.fold_book_text(array_to_string(kana, ''))
      || private.fold_book_text(array_to_string(array(
        select k from unnest(kana) with ordinality u (k, n) order by n desc), ''));
  end loop;
  return names;
end;
$$;
revoke all on function private.bib_romaji_names(text) from public, anon, authenticated;

-- The scripts a key is written in: Latin, Japanese (kana and kanji), Hangul,
-- Cyrillic, Greek, Hebrew, Arabic, Thai or Devanagari. Two titles with none
-- in common cannot be compared letter by letter.
create function private.bib_scripts(t text) returns text[]
language sql immutable set search_path = '' as $$
  select array_remove(array[
    case when t ~ '[A-Za-zÀ-ÖØ-öø-ɏ]' then 'latin' end,
    case when t ~ '[ぁ-ゟ゠-ヿ㐀-䶿一-鿿豈-﫿]' then 'japanese' end,
    case when t ~ '[ᄀ-ᇿ㄰-㆏가-힣]' then 'hangul' end,
    case when t ~ '[Ѐ-ӿ]' then 'cyrillic' end,
    case when t ~ '[Ͱ-Ͽ]' then 'greek' end,
    case when t ~ '[֐-׿]' then 'hebrew' end,
    case when t ~ '[؀-ۿ]' then 'arabic' end,
    case when t ~ '[฀-๿]' then 'thai' end,
    case when t ~ '[ऀ-ॿ]' then 'devanagari' end], null)
$$;
revoke all on function private.bib_scripts(text) from public, anon, authenticated;

-- Whether two keys share a run of letters: a third of the shorter one, two
-- at least (ハリポタ and ハリー・ポッター share はり; 海辺のカフカ and
-- ノルウェイの森 share nothing).
create function private.bib_overlap(a text, b text) returns boolean
language plpgsql immutable set search_path = '' as $$
declare
  n integer;
begin
  if coalesce(a, '') = '' or coalesce(b, '') = '' then
    return false;
  end if;
  n := greatest(2, ceil(least(char_length(a), char_length(b)) / 3.0)::integer);
  if least(char_length(a), char_length(b)) < n then
    return false;
  end if;
  for i in 1 .. char_length(a) - n + 1 loop
    if strpos(b, substr(a, i, n)) > 0 then
      return true;
    end if;
  end loop;
  return false;
end;
$$;
revoke all on function private.bib_overlap(text, text) from public, anon, authenticated;

-- The library's record, besides what ndl_answer already reads: the volume's
-- reading, and its other titles (the alternatives, with their readings, and
-- the original title its description gives, 原タイトル: FAHRENHEIT 451), the
-- first twenty, without repeats.
create function private.ndl_more(main xml) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'volume_reading', (
      select private.bib_text(x.v)
      from xmltable(
        xmlnamespaces('http://www.w3.org/1999/02/22-rdf-syntax-ns#' as rdf,
          'http://ndl.go.jp/dcndl/terms/' as dcndl),
        '/dcndl:BibResource' passing main
        columns v text path 'string(dcndl:volume[1]/rdf:Description/dcndl:transcription)') x),
    'alternatives', (
      select nullif(jsonb_agg(o.v order by o.n), '[]')
      from (
        select d.v, d.n
        from (
          select distinct on (a.v) a.v, a.n
          from (
            select private.bib_text(x.v) as v, x.n
            from xmltable(
              xmlnamespaces('http://www.w3.org/1999/02/22-rdf-syntax-ns#' as rdf,
                'http://ndl.go.jp/dcndl/terms/' as dcndl, 'http://purl.org/dc/terms/' as dcterms),
              '/dcndl:BibResource/dcndl:alternative/rdf:Description/rdf:value
               | /dcndl:BibResource/dcndl:alternative/rdf:Description/dcndl:transcription
               | /dcndl:BibResource/dcterms:alternative[not(*)]' passing main
              columns v text path 'string(.)', n for ordinality) x
            union all
            select private.bib_text(substring(x.v from '^\s*原タイトル\s*[:：]\s*(.+)$')), 1000 + x.n
            from xmltable(
              xmlnamespaces('http://purl.org/dc/terms/' as dcterms,
                'http://ndl.go.jp/dcndl/terms/' as dcndl),
              '/dcndl:BibResource/dcterms:description' passing main
              columns v text path 'string(.)', n for ordinality) x
          ) a
          where a.v is not null
          order by a.v, a.n
        ) d
        order by d.n
        limit 20
      ) o)))
$$;
revoke all on function private.ndl_more(xml) from public, anon, authenticated;

-- As before (bibliography), and what ndl_more reads too: the volume's
-- reading and the other titles, for comparing. The master shows neither
-- (edition_bibliography picks its fields by name).
create or replace function private.ndl_answer(content text, isbn text,
  out state text, out record text, out record_id text, out status text, out fields jsonb)
language plpgsql immutable set search_path = '' as $$
declare
  main xml;
  doc xml;
  t record;
  agents jsonb;
  named jsonb;
begin
  if content is null then
    state := 'failed';
    return;
  end if;
  begin
    doc := xmlparse(document content);
  exception when others then
    state := 'failed';
    return;
  end;
  if xpath_exists('/s:searchRetrieveResponse/s:diagnostics', doc,
      array[array['s', 'http://www.loc.gov/zing/srw/']]) then
    -- "Record does not exist" is how it says it has nothing for the ISBN.
    state := case when (
      select bool_and(x.m = 'Record does not exist')
      from xmltable(
        xmlnamespaces('http://www.loc.gov/zing/srw/' as s, 'http://www.loc.gov/zing/srw/diagnostic/' as d),
        '/s:searchRetrieveResponse/s:diagnostics/d:diagnostic' passing doc
        columns m text path 'string(d:message)') x
    ) then 'missing' else 'failed' end;
    return;
  end if;
  if not xpath_exists('/s:searchRetrieveResponse/s:numberOfRecords', doc,
      array[array['s', 'http://www.loc.gov/zing/srw/']]) then
    state := 'failed';
    return;
  end if;

  select r.main, nullif(r.status, '') into main, status
  from xmltable(
    xmlnamespaces('http://www.loc.gov/zing/srw/' as s,
      'http://www.w3.org/1999/02/22-rdf-syntax-ns#' as rdf,
      'http://ndl.go.jp/dcndl/terms/' as dcndl, 'http://purl.org/dc/terms/' as dcterms),
    '/s:searchRetrieveResponse/s:records/s:record/s:recordData/rdf:RDF' passing doc
    columns
      main xml path 'dcndl:BibResource[dcterms:title][1]',
      category text path 'string(dcndl:BibAdminResource/dcndl:bibRecordCategory)',
      status text path 'string(dcndl:BibAdminResource/dcndl:catalogingStatus)',
      n for ordinality) r
  cross join lateral (
    select coalesce(array_agg(private.isbn13(i.v)), array[]::text[]) as isbns
    from xmltable(
      xmlnamespaces('http://www.w3.org/1999/02/22-rdf-syntax-ns#' as rdf,
        'http://ndl.go.jp/dcndl/terms/' as dcndl, 'http://purl.org/dc/terms/' as dcterms),
      '/dcndl:BibResource/dcterms:identifier[@rdf:datatype = "http://ndl.go.jp/dcndl/terms/ISBN"]'
      passing r.main columns v text path '.') i
  ) k
  where r.category = 'R100000002' and r.main is not null and ndl_answer.isbn = any (k.isbns)
  order by r.status is not distinct from 'C3', cardinality(k.isbns), r.n
  limit 1;
  if main is null then
    state := 'missing';
    return;
  end if;
  state := 'found';
  record := main::text;

  select * into t
  from xmltable(
    xmlnamespaces('http://www.w3.org/1999/02/22-rdf-syntax-ns#' as rdf,
      'http://ndl.go.jp/dcndl/terms/' as dcndl, 'http://purl.org/dc/terms/' as dcterms,
      'http://purl.org/dc/elements/1.1/' as dc, 'http://xmlns.com/foaf/0.1/' as foaf),
    '/dcndl:BibResource' passing main
    columns
      bib_id text path 'dcterms:identifier[@rdf:datatype = "http://ndl.go.jp/dcndl/terms/NDLBibID"][1]',
      full_title text path 'string(dc:title[1]/rdf:Description/rdf:value)',
      plain_title text path 'string(dcterms:title[1])',
      full_reading text path 'string(dc:title[1]/rdf:Description/dcndl:transcription)',
      volume text path 'string(dcndl:volume[1]/rdf:Description/rdf:value)',
      edition text path 'string(dcndl:edition[1])',
      publisher text path 'string(dcterms:publisher[1]/foaf:Agent/foaf:name)',
      date text path 'string(dcterms:date[1])',
      issued text path 'string(dcterms:issued[1])') x;
  record_id := private.bib_text(t.bib_id);

  -- The people as the library's name authority has them, in order, and its
  -- statements of who made the book as the book itself puts it. When the
  -- statements name as many people as there are, in the same order, each
  -- person gets the name and the role the book gives them; else the name
  -- comes from the authority's heading (bib_person).
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'name', private.bib_person(a.name),
      'heading', private.bib_text(a.name),
      'reading', private.bib_person(a.reading, ' '),
      'authority', private.bib_text(a.about))) order by a.n), '[]')
  into agents
  from xmltable(
    xmlnamespaces('http://www.w3.org/1999/02/22-rdf-syntax-ns#' as rdf,
      'http://ndl.go.jp/dcndl/terms/' as dcndl, 'http://purl.org/dc/terms/' as dcterms,
      'http://xmlns.com/foaf/0.1/' as foaf),
    '/dcndl:BibResource/dcterms:creator/foaf:Agent' passing main
    columns name text path 'string(foaf:name)', reading text path 'string(dcndl:transcription)',
      about text path 'string(@rdf:about)', n for ordinality) a;
  select coalesce(jsonb_agg(jsonb_build_object('name', p.name, 'role', p.role) order by p.c, p.o), '[]')
  into named
  from (
    select c.n as c, u.o, u.name, k.role
    from xmltable(
      xmlnamespaces('http://ndl.go.jp/dcndl/terms/' as dcndl, 'http://purl.org/dc/elements/1.1/' as dc),
      '/dcndl:BibResource/dc:creator' passing main
      columns credit text path '.', n for ordinality) c
    cross join lateral private.ndl_credit(c.credit) k
    cross join lateral unnest(k.names) with ordinality u (name, o)
  ) p;
  if jsonb_array_length(named) = jsonb_array_length(agents) then
    select jsonb_agg(a.v || jsonb_strip_nulls(n.v) order by a.i)
    into agents
    from jsonb_array_elements(agents) with ordinality a (v, i)
    join jsonb_array_elements(named) with ordinality n (v, i) on n.i = a.i;
  end if;

  fields := jsonb_strip_nulls(jsonb_build_object(
    'title', (private.bib_title_parts(coalesce(nullif(t.full_title, ''), t.plain_title))).title,
    'title_reading', (private.bib_title_parts(t.full_reading)).title,
    'subtitle', (private.bib_title_parts(coalesce(nullif(t.full_title, ''), t.plain_title))).subtitle,
    'volume', private.bib_text(t.volume),
    'edition', private.bib_text(t.edition),
    'publisher', private.bib_text(t.publisher),
    'issued', coalesce(private.bib_issued(t.date), private.bib_issued(t.issued)),
    'ndc', (
      select substring(s.r from '/class/ndc(?:10|9|8)/(.+)$')
      from xmltable(
        xmlnamespaces('http://www.w3.org/1999/02/22-rdf-syntax-ns#' as rdf,
          'http://ndl.go.jp/dcndl/terms/' as dcndl, 'http://purl.org/dc/terms/' as dcterms),
        '/dcndl:BibResource/dcterms:subject[@rdf:resource]' passing main
        columns r text path 'string(@rdf:resource)') s
      where s.r ~ '/class/ndc(10|9|8)/'
      order by substring(s.r from '/class/ndc(10|9|8)/')::int desc
      limit 1),
    'series', (
      select nullif(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
          'name', private.bib_text(coalesce(v[1], s.value)),
          'number', private.bib_text(v[2]),
          'reading', private.bib_text(coalesce(r[1], s.reading)))) order by s.n), '[]')
      from xmltable(
        xmlnamespaces('http://www.w3.org/1999/02/22-rdf-syntax-ns#' as rdf,
          'http://ndl.go.jp/dcndl/terms/' as dcndl),
        '/dcndl:BibResource/dcndl:seriesTitle/rdf:Description' passing main
        columns value text path 'string(rdf:value)', reading text path 'string(dcndl:transcription)',
          n for ordinality) s
      cross join lateral regexp_match(s.value, '^(.*?)\s+;\s+(.*)$') v
      cross join lateral regexp_match(s.reading, '^(.*?)\s+;\s+(.*)$') r
      where private.bib_text(s.value) is not null),
    'creators', nullif(agents, '[]'),
    'credits', (
      select nullif(jsonb_agg(private.bib_text(c.credit) order by c.n), '[]')
      from xmltable(
        xmlnamespaces('http://ndl.go.jp/dcndl/terms/' as dcndl, 'http://purl.org/dc/elements/1.1/' as dc),
        '/dcndl:BibResource/dc:creator' passing main
        columns credit text path '.', n for ordinality) c
      where private.bib_text(c.credit) is not null)));
  fields := fields || private.ndl_more(main);
end;
$$;
revoke all on function private.ndl_answer(text, text) from public, anon, authenticated;

-- Judging ---------------------------------------------------------------------------

-- What a reader typed for a book (title, author) against the master's title,
-- subtitle, volume, title reading and creators, and the library's other
-- titles and reading of the volume: same, close, apart or none (the top of
-- this file, and of 20261102000000_bibliography_holds.sql).
create function private.bib_verdict(title text, author text, m_title text,
  m_subtitle text, m_volume text, m_reading text, m_creators jsonb,
  m_alternatives jsonb, m_volume_reading text) returns text
language plpgsql immutable set search_path = '' as $$
declare
  mine text := nullif(private.bib_key(title), '');
  whole text[] := array[
    private.bib_key(m_title),
    private.bib_key(m_title || coalesce(m_volume, '')),
    private.bib_key(m_title || coalesce(m_subtitle, '')),
    private.bib_key(m_title || coalesce(m_subtitle, '') || coalesce(m_volume, ''))];
  reading text := private.bib_key(m_reading);
  others text[] := array(
    select private.bib_key(a)
    from jsonb_array_elements_text(
      case when jsonb_typeof(m_alternatives) = 'array' then m_alternatives else '[]' end) a
    where private.bib_key(a) <> '');
  -- The title typed in romaji, as kana: compared with the title's reading.
  heard text := private.fold_book_text(private.bib_romaji(title));
  told text := coalesce(private.bib_volume_start(m_volume),
    private.bib_volume_heard(m_volume_reading));
  romaji text[] := private.bib_romaji_names(author);
  t text;
  person jsonb;
  form text;
  keys text[];
  folded text;
  raw text;
  theirs text;
  typed record;
  one boolean;
  agrees boolean := false;
begin
  if mine = any (whole) then
    return 'same';
  end if;
  -- A volume: what the reader typed is the master's title (with its subtitle
  -- or not, or its reading) and a volume, and the master tells its volume, in
  -- the volume or at the end of the title. The same volume written another
  -- way is the same (第1巻, （１）, 上 for 1, 巻1); another volume is apart,
  -- whatever else agrees (one work is one volume). No volume typed is
  -- neither: the rest decides.
  select * into typed from private.bib_volume(title);
  if typed.mark is not null and typed.base <> '' then
    with told_as (base, mark) as (
      select private.bib_key(m_title), told
      union all
      select private.bib_key(m_title || m_subtitle), told where coalesce(m_subtitle, '') <> ''
      union all
      select x.base, x.mark from private.bib_volume(m_title) x
      union all
      select reading, told where reading <> ''
      union all
      select x.base, x.mark from private.bib_volume(m_reading) x
    )
    select bool_or(private.bib_same_volume(w.mark, typed.mark)) into one
    from told_as w
    where w.base = typed.base and w.mark is not null;
    if one then
      return 'same';
    elsif not one then
      return 'apart';
    end if;
  end if;
  -- One title inside the other: the master's, its reading or another of its
  -- titles; or the title typed in romaji and the reading.
  foreach t in array whole || reading || others loop
    if mine is not null and t <> '' and least(char_length(mine), char_length(t)) >= 2
        and (strpos(mine, t) > 0 or strpos(t, mine) > 0) then
      return 'close';
    end if;
  end loop;
  if coalesce(heard, '') <> '' and reading <> ''
      and least(char_length(heard), char_length(reading)) >= 2
      and (strpos(heard, reading) > 0 or strpos(reading, heard) > 0) then
    return 'close';
  end if;
  -- An author: as the name is printed, as it reads, or the authority's form
  -- without its years (Bradbury, Ray, 1920-2012 for レイ・ブラッドベリ), or
  -- in romaji as the name reads. One in a script the folding drops, by the
  -- whole line. The first twenty of the master's (an anthology may list
  -- hundreds).
  keys := private.author_keys(author);
  folded := private.fold_book_text(author);
  raw := case when folded = '' then private.bib_key(author) else '' end;
  <<people>>
  for person in
    select x from jsonb_array_elements(
      case when jsonb_typeof(m_creators) = 'array' then m_creators else '[]' end) x
    limit 20
  loop
    foreach form in array array[person ->> 'name', person ->> 'reading',
        regexp_replace(person ->> 'heading', ',\s*[0-9][-0-9?.]*\s*$', '')] loop
      theirs := private.bib_key(form);
      if form is not null and (private.authors_agree(keys, folded,
            private.author_keys(form), private.fold_book_text(form))
          or (raw <> '' and least(char_length(raw), char_length(theirs)) >= 2
            and (strpos(raw, theirs) > 0 or strpos(theirs, raw) > 0))
          or romaji && private.author_keys(form)) then
        agrees := true;
        exit people;
      end if;
    end loop;
  end loop;
  -- An author agreeing makes it close when the titles share letters, or
  -- cannot be compared (no letter typed, or written in no script of the
  -- master's title and its reading); else it is another book of theirs.
  if agrees then
    if mine is null
        or not (private.bib_scripts(mine)
          && (private.bib_scripts(whole[1]) || private.bib_scripts(reading)))
        or private.bib_overlap(heard, reading) then
      return 'close';
    end if;
    foreach t in array whole || reading || others loop
      if private.bib_overlap(mine, t) then
        return 'close';
      end if;
    end loop;
    return 'apart';
  end if;
  -- Nothing to compare in the title, and no author agreeing.
  return case when mine is null then 'none' else 'apart' end;
end;
$$;
revoke all on function private.bib_verdict(text, text, text, text, text, text, jsonb, jsonb, text)
  from public, anon, authenticated;
drop function private.bib_verdict(text, text, text, text, text, text, jsonb);

-- What the book sees of the library's record besides the master: its other
-- titles, while the title shown is the library's, and its reading of the
-- volume, while the volume shown is the library's (sources: which source
-- each field shown came from, edition_bibliography). Only what was asked for
-- the book's turn or a later one, as the master.
create function private.bib_compared(ed uuid, since timestamptz, sources jsonb,
  out alternatives jsonb, out volume_reading text)
language sql stable set search_path = '' as $$
  select case when sources ->> 'title' = 'ndl' then s.fields -> 'alternatives' end,
    case when sources ->> 'volume' = 'ndl' then s.fields ->> 'volume_reading' end
  from private.edition_sources s
  where s.edition_id = ed and s.source = 'ndl' and s.state <> 'withdrawn'
    and coalesce(s.found_for, '-infinity') >= since
$$;
revoke all on function private.bib_compared(uuid, timestamptz, jsonb)
  from public, anon, authenticated;

-- As before (holds), with what the book sees of the library's record besides
-- the master, and a book held stays in its work: held_work is the work it
-- was in when it was held, and only says it is held.
create or replace function private.bib_judge() returns void
language plpgsql security definer set search_path = '' as $$
declare
  k record;
  m record;
  more record;
  v text;
begin
  begin
    lock table public.books in row exclusive mode nowait;
  exception when lock_not_available then
    return;
  end;
  delete from private.book_rechecks r
  where not exists (
    select 1 from private.book_checks c
    where c.book_id = r.book_id and c.confirmed_at is null);
  for k in
    with due (book_id) as (
      select c.book_id from private.book_checks c
      where c.checked_at is null and c.placed_at <= now() - interval '10 minutes'
      union
      select r.book_id from private.book_rechecks r
      union
      select c.book_id from private.book_checks c
      where c.verdict is null and c.placed_at <= now() - interval '1 day')
    select c.book_id, c.placed_at, c.verdict, c.confirmed_at, c.held_work,
      b.title, b.author, b.work_id, b.edition_id, e.isbn
    from due
    join private.book_checks c on c.book_id = due.book_id
    join public.books b on b.id = c.book_id
    join public.editions e on e.id = b.edition_id
    where c.confirmed_at is null
      and c.placed_at <= now() - interval '10 minutes'
    order by c.verdict is not null, c.placed_at, c.book_id
    limit 300
    for no key update of c, b skip locked
  loop
    delete from private.book_rechecks r where r.book_id = k.book_id;
    if k.isbn is null then
      v := 'none';
    else
      select * into m from private.edition_bibliography(k.edition_id, k.placed_at);
      if m.title is null then
        if k.placed_at > now() - interval '1 day' and exists (
            select 1 from private.edition_sources s
            where s.edition_id = k.edition_id and s.state <> 'withdrawn'
              and coalesce(s.settled_for, '-infinity') < k.placed_at) then
          update private.book_checks c set checked_at = now() where c.book_id = k.book_id;
          continue;
        end if;
        v := 'none';
      else
        select * into more from private.bib_compared(k.edition_id, k.placed_at, m.sources);
        v := private.bib_verdict(k.title, k.author, m.title, m.subtitle, m.volume,
          m.title_reading, m.creators, more.alternatives, more.volume_reading);
      end if;
    end if;
    update private.book_checks c set checked_at = now(), verdict = v,
      judged_at = case when c.verdict is distinct from v then now() else c.judged_at end,
      held_work = case when v = 'apart' then coalesce(k.held_work, k.work_id) end
    where c.book_id = k.book_id;
  end loop;
end;
$$;
revoke all on function private.bib_judge() from public, anon, authenticated;

-- As before (holds), and when the book was placed: held a day or more after
-- it, it is a book registered before, and the notice says so.
drop function public.book_holds();
create function public.book_holds()
returns table (book_id uuid, held_at timestamptz, placed_at timestamptz, title text,
  creators jsonb)
language sql stable security definer set search_path = '' as $$
  select b.id, c.judged_at, c.placed_at, d.title, d.creators
  from public.books b
  join private.book_checks c on c.book_id = b.id
  cross join lateral private.edition_bibliography(b.edition_id, c.placed_at) d
  where b.created_by = (select auth.uid())
    and c.held_work is not null
    and d.title is not null
  order by c.judged_at, b.id
$$;
revoke all on function public.book_holds() from public, anon, authenticated;
grant execute on function public.book_holds() to authenticated;

-- As before (holds): the reader says a book they hold back is the ISBN's
-- after all; the master shows for it, and it is not judged again until it is
-- placed again. It is in its edition's work already.
create or replace function public.confirm_book_isbn(book uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform 1
  from public.books b
  join private.book_checks c on c.book_id = b.id
  where b.id = confirm_book_isbn.book and b.created_by = (select auth.uid())
    and c.held_work is not null
  for no key update of b, c;
  if not found then
    raise exception 'no book of yours is held with that id' using errcode = 'P0002';
  end if;
  update private.book_checks c
  set confirmed_at = now(), checked_at = now(), held_work = null
  where c.book_id = confirm_book_isbn.book;
end;
$$;
revoke all on function public.confirm_book_isbn(uuid) from public, anon, authenticated;
grant execute on function public.confirm_book_isbn(uuid) to authenticated;

-- As before (holds), for the operator, the same way.
create or replace function private.release_hold(book uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform 1
  from public.books b
  join private.book_checks c on c.book_id = b.id
  where b.id = release_hold.book and c.held_work is not null
  for no key update of b, c;
  if not found then
    raise exception 'no book is held with that id' using errcode = 'P0002';
  end if;
  update private.book_checks c
  set confirmed_at = now(), checked_at = now(), held_work = null
  where c.book_id = release_hold.book;
end;
$$;
revoke all on function private.release_hold(uuid) from public, anon, authenticated;

-- The move ---------------------------------------------------------------------------

-- A book held in a work of its own goes back to its edition's work, written
-- down as the reader's answer is, and stays held.
insert into private.work_changes (book_id, from_work, to_work, kind)
select b.id, b.work_id, e.work_id, 'unhold'
from private.book_checks c
join public.books b on b.id = c.book_id
join public.editions e on e.id = b.edition_id
where c.held_work is not null and b.work_id is distinct from e.work_id;
update public.books b set work_id = e.work_id
from public.editions e, private.book_checks c
where e.id = b.edition_id and c.book_id = b.id and c.held_work is not null
  and b.work_id is distinct from e.work_id;
update private.book_checks c set held_work = b.work_id
from public.books b
where b.id = c.book_id and c.held_work is not null;

-- The library's records kept, read again for the volume's reading and the
-- other titles.
-- (A record that does not read is left as it is.)
do $$
declare
  r record;
  more jsonb;
begin
  for r in
    select s.edition_id, s.record from private.edition_sources s
    where s.source = 'ndl' and s.record is not null
    order by s.edition_id
  loop
    begin
      more := private.ndl_more(r.record::xml);
    exception when others then
      more := '{}';
    end;
    if more <> '{}' then
      update private.edition_sources s set fields = s.fields || more
      where s.edition_id = r.edition_id and s.source = 'ndl';
    end if;
  end loop;
end;
$$;

-- Every book with an ISBN its reader has not confirmed is compared again on
-- the next ticks.
update private.book_checks c set checked_at = null
from public.books b
where b.id = c.book_id and b.isbn is not null and c.confirmed_at is null;

select private.check_copy('20261118000000_bibliography_judging');
