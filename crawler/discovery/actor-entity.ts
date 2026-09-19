/**
 * AniList の staff 集計から「対象声優」のエンティティを組み立てる純粋関数。
 *
 * ここは fetch も fs も触らない。CLI 側 (`build-actors.ts`) が読み書きを持ち、
 * 規則そのものはここに閉じる。slug は URL に出て後から変えられないので、
 * 規則を単体テストで固定しておく必要がある
 */

/** `anilist-staff.json` の `staff[]` のうち、エンティティ生成に要る項目だけ */
export type StaffInput = {
  anilistStaffId: number;
  /** 日本語表記。DLsite / Audible との突き合わせに使う唯一の鍵 */
  nativeName: string;
  /** "Reina Ueda" のような名-姓のローマ字表記 */
  fullName?: string;
  roleCount?: number;
  /** 同じ nativeName を別の staff id も持っている。取り違えるので対象から外す */
  ambiguous?: boolean;
};

/**
 * `crawler/actors-overrides.json` の 1 件。キーは canonicalName (= AniList の nativeName)。
 * AniList から取れない情報 (かな) と、実測で確かめた情報 (別名 / 衝突解決 / 英語表記の訂正) だけを手で持つ
 */
export type ActorOverride = {
  nameKana?: string;
  /**
   * 英語表示に出すローマ字表記。AniList の `fullName` より優先する。
   * AniList はワープロ式で書く ("Youko Hikasa") ので、本人・事務所の公表表記と食い違う人をここで直す
   */
  nameEn?: string;
  /**
   * 検証済みの別名。Audible で実際に結果が返ることを確かめた表記だけを書く。
   * 1 件でもあれば自動生成の候補は使わない (当てずっぽうを混ぜると検索回数が増えるだけのため)
   */
  aliases?: string[];
  /**
   * slug を人手で決めた場合の値。生成規則が別人と衝突したときにだけ使う。
   * 自動で連番を振ると同名別人を取り違えるので、解決は必ず人が書く
   */
  slug?: string;
};

export type ActorOverrides = Record<string, ActorOverride>;

export type ActorAlias = { name: string; source: "manual"; verified: boolean };

/** `crawler/actors.generated.json` の 1 件。`crawler/run.ts` と ingest の zod がそのまま受け取れる */
export type ActorEntity = {
  id: string;
  slug: string;
  canonicalName: string;
  nameKana?: string;
  /** "Reina Ueda"。slug からは姓名の順も大文字も戻せないので別に持つ */
  nameEn?: string;
  anilistStaffId: number;
  status: "active";
  aliases: ActorAlias[];
};

export type ExclusionReason =
  | "ambiguous"
  | "no-native-name"
  /** fullName が無い、または記号だけで中身が残らず slug を作れない */
  | "no-slug";

export type Exclusion = {
  anilistStaffId: number;
  nativeName: string;
  fullName?: string;
  reason: ExclusionReason;
};

/** 同じ slug になった 2 人以上。生成を失敗させて人に判断させるための材料 */
export type SlugCollision = {
  slug: string;
  members: Array<{ anilistStaffId: number; canonicalName: string }>;
};

export type BuildResult = {
  actors: ActorEntity[];
  excluded: Exclusion[];
  collisions: SlugCollision[];
  /** overrides に書いてあるが AniList 側に居なかった canonicalName。書き損じの検出用 */
  unusedOverrideKeys: string[];
};

// --- slug ------------------------------------------------------------------

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
 * 手書きシードの 10 人はこの規則で slug が変わるが、未公開なので許容する。
 *
 * 語が 3 つ以上のとき (「ブリドカット・セーラ・恵美」= Sarah Emi Bridcutt) は
 * 最後の語を姓、残りを名として前から並べる → `bridcutt-sarah-emi`
 *
 * 1 語しかない名義 (「ゆかな」「麦人」「KENN」) は姓と名に分けられないので、
 * その語をそのまま slug にする (除外すると実在の声優が
 * 対象声優リストから丸ごと落ちるため)。記号だけで中身が残らない場合だけ undefined を返す
 */
export function toActorSlug(fullName: string | undefined): string | undefined {
  if (fullName === undefined) return undefined;

  const tokens = tokenizeFullName(fullName);
  const surname = tokens.at(-1);
  if (surname === undefined) return undefined;
  if (tokens.length === 1) return surname;

  return [surname, ...tokens.slice(0, -1)].join("-");
}

/**
 * `fullName` が 1 語かどうか。1 語の名義には姓と名の境界が無いので、
 * `spacedNameCandidates` の機械的な区切りを適用すると誤った空白を混ぜることになる。
 * そのため `buildAliases` はこの語のときだけ生成候補を作らない
 */
function isSingleWordFullName(fullName: string | undefined): boolean {
  if (fullName === undefined) return false;
  return tokenizeFullName(fullName).length === 1;
}

// --- 英語表記 --------------------------------------------------------------

/**
 * 英語表示に出すローマ字表記。AniList の `fullName` ("Reina Ueda") をそのまま使う。
 *
 * 直すのは空白だけ。AniList には改行や二重空白が混じった fullName ("Makoto\r\n Takahashi") があり、
 * そのまま画面に出すと名前が割れて見える。つづりには触らない:
 * `Youko Hikasa` を `Yoko Hikasa` に寄せるのは規則では決められず (`Inoue` / `Matsuura` を壊す)、
 * 正しい表記は人ごとの公表表記でしか決まらないので `ActorOverride.nameEn` で直す。
 *
 * 空白を詰めて何も残らない fullName は英語表記なしとして undefined を返す
 * (`toActorSlug` が slug を作れず除外される人と同じ材料なので、実際にはここまで来ない)
 */
export function toActorNameEn(fullName: string | undefined): string | undefined {
  if (fullName === undefined) return undefined;
  const collapsed = fullName.trim().replace(/\s+/g, " ");
  return collapsed === "" ? undefined : collapsed;
}

// --- 別名 ------------------------------------------------------------------

/**
 * 姓をこの文字数で切って空白を入れるか。名前の長さによって姓の文字数の相場が変わるため、
 * canonicalName の長さで切り方を変える。
 *
 * - 2 文字 (「林勇」) → 1 文字切りしか作りようがない
 * - 3 文字 (「林大地」) → 1 文字切りと 2 文字切り (姓が 1 文字か 2 文字かは名前からは分からない)
 * - 4 文字以上 (「上田麗奈」) → 実測で正解の表記が 6/6 含まれた 2 文字切りと 3 文字切り
 *
 * どの長さでも候補は常に 2 個以下 (Audible への試行回数を増やさないため)
 */
function surnameCutLengthsFor(nameLength: number): readonly number[] {
  if (nameLength <= 2) return [1];
  if (nameLength === 3) return [1, 2];
  return [2, 3];
}

/**
 * Audible 向けの空白入り候補。「上田麗奈」→ ["上田 麗奈", "上田麗 奈"]。
 *
 * Audible のナレーター検索は名前によって空白の有無で結果が変わる
 * (実測: 「石見舞菜香」は該当なし、「石見 舞菜香」だと 2 件)。どこで切るのが正しいかは
 * AniList から分からないので、両方を候補として持たせて adapter に順に試させる
 */
export function spacedNameCandidates(canonicalName: string): string[] {
  // 「﨑」のような異体字やサロゲートペアを 1 文字として数えるため、コードポイントで割る
  const chars = [...canonicalName];
  const candidates: string[] = [];
  for (const cut of surnameCutLengthsFor(chars.length)) {
    if (chars.length <= cut) continue;
    candidates.push(`${chars.slice(0, cut).join("")} ${chars.slice(cut).join("")}`);
  }
  return candidates;
}

/**
 * 別名の確定。オーバーライドに検証済みの表記があればそれだけを使い、
 * 無ければ自動生成の候補を未検証として持たせる。
 *
 * `singleWordName` が true (fullName が 1 語) のときは、姓と名の境界が無く
 * 機械的な区切りが当てずっぽうにしかならないので候補を作らない
 */
export function buildAliases(
  canonicalName: string,
  override: ActorOverride | undefined,
  singleWordName = false,
): ActorAlias[] {
  const verified = override?.aliases ?? [];
  if (verified.length > 0) {
    return verified.map((name) => ({ name, source: "manual", verified: true }));
  }
  if (singleWordName) return [];
  return spacedNameCandidates(canonicalName).map((name) => ({
    name,
    source: "manual",
    verified: false,
  }));
}

// --- 組み立て --------------------------------------------------------------

/**
 * staff 1 件をエンティティにする。除外する場合は理由を返す。
 * slug の衝突はここでは見ない (全体を見ないと分からないため)
 */
export function buildActorEntity(
  staff: StaffInput,
  overrides: ActorOverrides = {},
): { actor: ActorEntity } | { excluded: Exclusion } {
  const canonicalName = staff.nativeName.trim();
  const base = {
    anilistStaffId: staff.anilistStaffId,
    nativeName: canonicalName,
    ...(staff.fullName === undefined ? {} : { fullName: staff.fullName }),
  };

  if (canonicalName === "") return { excluded: { ...base, reason: "no-native-name" } };
  // 同名の別 staff が居る人は「誰の作品か」を断定できない。取り違えるくらいなら出さない
  if (staff.ambiguous === true) return { excluded: { ...base, reason: "ambiguous" } };

  const override = overrides[canonicalName];
  const slug = override?.slug ?? toActorSlug(staff.fullName);
  if (slug === undefined) return { excluded: { ...base, reason: "no-slug" } };

  // 手で書いた表記が AniList のワープロ式より優先される。書いていない人は AniList のまま
  const nameEn = override?.nameEn ?? toActorNameEn(staff.fullName);

  return {
    actor: {
      id: `va_${slug}`,
      slug,
      canonicalName,
      ...(override?.nameKana === undefined ? {} : { nameKana: override.nameKana }),
      ...(nameEn === undefined ? {} : { nameEn }),
      anilistStaffId: staff.anilistStaffId,
      status: "active",
      aliases: buildAliases(canonicalName, override, isSingleWordFullName(staff.fullName)),
    },
  };
}

/** staff 配列をまるごとエンティティにする。並び順は入力のまま (roleCount 降順) */
export function buildActorEntities(
  staff: readonly StaffInput[],
  overrides: ActorOverrides = {},
): BuildResult {
  const actors: ActorEntity[] = [];
  const excluded: Exclusion[] = [];
  const usedOverrideKeys = new Set<string>();

  for (const record of staff) {
    const result = buildActorEntity(record, overrides);
    if ("excluded" in result) {
      excluded.push(result.excluded);
      continue;
    }
    actors.push(result.actor);
    if (overrides[result.actor.canonicalName] !== undefined) {
      usedOverrideKeys.add(result.actor.canonicalName);
    }
  }

  return {
    actors,
    excluded,
    collisions: findSlugCollisions(actors),
    unusedOverrideKeys: Object.keys(overrides).filter((key) => !usedOverrideKeys.has(key)),
  };
}

/**
 * 同じ slug になった声優を集める。
 *
 * 見つかっても `-2` のような連番は振らない。ローマ字が同じ別人 (三波春香 / 南波遥海) を
 * 機械的に分けると、どちらが `/voice-actors/minami-haruka` なのかが実行のたびに入れ替わり、
 * 別人の作品が混ざる。どちらを正とするかは人が overrides に書く
 */
export function findSlugCollisions(actors: readonly ActorEntity[]): SlugCollision[] {
  const bySlug = new Map<string, ActorEntity[]>();
  for (const actor of actors) {
    const group = bySlug.get(actor.slug);
    if (group) group.push(actor);
    else bySlug.set(actor.slug, [actor]);
  }

  const collisions: SlugCollision[] = [];
  for (const [slug, group] of bySlug) {
    if (group.length < 2) continue;
    collisions.push({
      slug,
      members: group.map((actor) => ({
        anilistStaffId: actor.anilistStaffId,
        canonicalName: actor.canonicalName,
      })),
    });
  }
  return collisions;
}

/** 除外理由を人が読む 1 行にする */
export function describeExclusionReason(reason: ExclusionReason): string {
  switch (reason) {
    case "ambiguous":
      return "同名の別 staff が居る";
    case "no-native-name":
      return "日本語表記が無い";
    case "no-slug":
      return "fullName が無い、または記号だけで slug を作れない";
  }
}
