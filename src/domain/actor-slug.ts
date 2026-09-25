/**
 * 声優の slug と英語表記の生成規則。
 *
 * slug は URL (`/voice-actors/{slug}`) に出て後から変えられないので、規則をここに閉じて
 * 単体テストで固定する。ドメイン層に置くのは、取り込みを受ける Worker (`src/server`) と
 * クローラー (`crawler`) の両方から同じ規則を呼ぶため
 */

/**
 * `fullName` を slug 用のトークン列にする。AniList には改行入りの fullName
 * ("Makoto\r\n Takahashi") があるので空白全般で割る。記号 ("Kukkii!" の "!") は
 * URL に出したくないので落とす
 */
function tokenizeFullName(fullName: string): string[] {
  return fullName
    .split(/\s+/)
    .map((token) => token.toLowerCase().replace(/[^a-z0-9]/g, ""))
    .filter((token) => token !== "");
}

/**
 * AniList の `fullName` ("Reina Ueda") を姓-名の順の slug ("ueda-reina") にする。
 *
 * **AniList のワープロ式表記をそのまま使う**。`Akari Kitou` → `kitou-akari`、
 * `Aoi Yuuki` → `yuuki-aoi`。長音を潰して `kito` / `yuki` に寄せることはしない。
 * 「ou」「uu」が長音とは限らず (井上 = Inoue、松浦 = Matsuura)、潰すと別の名前を壊すため。
 *
 * 語が 3 つ以上のとき (「ブリドカット・セーラ・恵美」= Sarah Emi Bridcutt) は
 * 最後の語を姓、残りを名として前から並べる → `bridcutt-sarah-emi`
 *
 * 1 語しかない名義 (「ゆかな」「麦人」「KENN」) は姓と名に分けられないので、
 * その語をそのまま slug にする (除外すると実在の声優が対象から丸ごと落ちるため)。
 * 記号だけで中身が残らない場合だけ undefined を返す
 */
export function toActorSlug(fullName: string | undefined): string | undefined {
  if (fullName === undefined) return undefined;

  const tokens = tokenizeFullName(fullName);
  const surname = tokens.at(-1);
  if (surname === undefined) return undefined;
  if (tokens.length === 1) return surname;

  return [surname, ...tokens.slice(0, -1)].join("-");
}

/** `fullName` が 1 語かどうか。姓と名の境界が無いので、機械的な区切りを当てられない */
export function isSingleWordFullName(fullName: string | undefined): boolean {
  if (fullName === undefined) return false;
  return tokenizeFullName(fullName).length === 1;
}

/**
 * ローマ字が同じ別人 (三波春香 / 南波遥海 = どちらも `minami-haruka`) に与える slug。
 *
 * 先に居た人が元の slug を持ち、後から来た人だけがこの形になる。連番を振らないのは、
 * 取り込むたびに誰が `-2` になるかが入れ替わり、別人の URL が入れ替わるため。
 * staff id は声優ごとに不変なので、同じ人はいつ取り込んでも同じ slug になる
 */
export function slugWithStaffId(slug: string, anilistStaffId: number): string {
  return `${slug}-${anilistStaffId}`;
}

/** 声優 ID。slug から作るので、slug が決まれば ID も決まる */
export function toActorId(slug: string): string {
  return `va_${slug}`;
}

/**
 * 英語表示に出すローマ字表記。AniList の `fullName` ("Reina Ueda") をそのまま使う。
 *
 * 直すのは空白だけ。AniList には改行や二重空白が混じった fullName ("Makoto\r\n Takahashi") があり、
 * そのまま画面に出すと名前が割れて見える。つづりには触らない:
 * `Youko Hikasa` を `Yoko Hikasa` に寄せるのは規則では決められず (`Inoue` / `Matsuura` を壊す)、
 * 正しい表記は人ごとの公表表記でしか決まらない。直すときは付加情報の `nameEn` を書く。
 *
 * 空白を詰めて何も残らない fullName は英語表記なしとして undefined を返す
 */
export function toActorNameEn(fullName: string | undefined): string | undefined {
  if (fullName === undefined) return undefined;
  const collapsed = fullName.trim().replace(/\s+/g, " ");
  return collapsed === "" ? undefined : collapsed;
}
