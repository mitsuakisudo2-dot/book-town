-- The folding the search and the judging compare on, made the same in the
-- database as in the app (AUD-084; src/lib/search/fold.ts, searchFold).
--
-- private.fold_book_text (20261027000000_works.sql) kept the characters from
-- 豈 to U+FAFF, meaning the compatibility ideograph U+F900, but the file had
-- been normalized to NFC and that 豈 became the kanji U+8C48. So the database
-- kept Hangul, the private use area and everything else from U+8C48 on,
-- while the app dropped them: a Korean title folded to nothing in the app's
-- search and to itself in the database.
--
-- Now both keep the same, written by code point so no normalizing can change
-- it: digits, a–z, hiragana, 々〆, kanji and the compatibility ideographs, and
-- the letters of Greek, Cyrillic, Arabic (without its vowel marks, as Latin
-- loses its accents), Thai and Hangul, with Greek and Cyrillic capitals as
-- small letters. The private use area and the rest are dropped.
--
-- What changes for the judging (bibliography_holds): a title in Greek,
-- Cyrillic, Arabic or Thai is still compared whole by private.bib_key, as
-- before, and a Hangul title folds as before. An author line in Greek or
-- Cyrillic now has people in it (author_keys), so Толстой, Лев and Лев
-- Толстой are one person, as ブラッドベリ, レイ and レイ・ブラッドベリ are.
--
-- No folded text is kept in any table (work_candidates and the judging fold
-- as they read), so no row changes. Nothing to copy (private.keep_copy)
-- before it. To undo it, run the create or replace of fold_book_text from
-- 20261027000000_works.sql again.
--
-- tests/db-works.test.ts compares the two foldings, character by character.

create or replace function private.fold_book_text(t text) returns text
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
