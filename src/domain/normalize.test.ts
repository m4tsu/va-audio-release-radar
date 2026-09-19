import { describe, expect, test } from "vitest";
import { nameVariantPairs, normalizeName } from "./normalize.ts";

describe("normalizeName", () => {
  test("半角スペースと全角スペースの有無を吸収する", () => {
    expect(normalizeName("上田 麗奈")).toBe(normalizeName("上田麗奈"));
    expect(normalizeName("上田　麗奈")).toBe(normalizeName("上田麗奈"));
  });

  test("中黒 (・) を除去する", () => {
    expect(normalizeName("上田・麗奈")).toBe(normalizeName("上田麗奈"));
  });

  test("括弧・読点・句点・スラッシュ・ダッシュ類・記号を除去する", () => {
    expect(normalizeName("「上田麗奈」")).toBe(normalizeName("上田麗奈"));
    expect(normalizeName("【上田麗奈】")).toBe(normalizeName("上田麗奈"));
    expect(normalizeName("上田(麗奈)")).toBe(normalizeName("上田麗奈"));
    expect(normalizeName("上田（麗奈）")).toBe(normalizeName("上田麗奈"));
    expect(normalizeName("上田、麗奈")).toBe(normalizeName("上田麗奈"));
    expect(normalizeName("上田。麗奈")).toBe(normalizeName("上田麗奈"));
    expect(normalizeName("上田,麗奈")).toBe(normalizeName("上田麗奈"));
    expect(normalizeName("上田.麗奈")).toBe(normalizeName("上田麗奈"));
    expect(normalizeName("上田/麗奈")).toBe(normalizeName("上田麗奈"));
    expect(normalizeName("上田／麗奈")).toBe(normalizeName("上田麗奈"));
    expect(normalizeName("上田-麗奈")).toBe(normalizeName("上田麗奈"));
    expect(normalizeName("上田‐麗奈")).toBe(normalizeName("上田麗奈"));
    expect(normalizeName("上田ー麗奈")).toBe(normalizeName("上田麗奈"));
    expect(normalizeName("上田麗奈?")).toBe(normalizeName("上田麗奈"));
    expect(normalizeName("上田麗奈？")).toBe(normalizeName("上田麗奈"));
    expect(normalizeName("上田麗奈!")).toBe(normalizeName("上田麗奈"));
    expect(normalizeName("上田麗奈！")).toBe(normalizeName("上田麗奈"));
  });

  test("全角英数を半角化し、英字は小文字化する (NFKC)", () => {
    expect(normalizeName("ＡＢＣ")).toBe("abc");
    expect(normalizeName("ABC")).toBe("abc");
  });

  test("前置語 (例: CV.) は除去しない。別人格として扱う", () => {
    expect(normalizeName("CV.上田麗奈")).not.toBe(normalizeName("上田麗奈"));
  });

  test("かな⇄カナの変換はしない", () => {
    expect(normalizeName("うえだれいな")).not.toBe(normalizeName("ウエダレイナ"));
  });

  test("空文字は空文字のまま", () => {
    expect(normalizeName("")).toBe("");
  });

  test("記号だけの文字列は空文字になる", () => {
    expect(normalizeName("・ 　()")).toBe("");
  });
});

describe("normalizeName の異体字の畳み込み", () => {
  test("NFKC が畳む互換漢字は従来どおり畳まれる (塚 U+FA10 → 塚 U+585A)", () => {
    expect("塚".normalize("NFKC")).toBe("塚");
    expect(normalizeName("大塚明夫")).toBe(normalizeName("大塚明夫"));
  });

  test("NFKC が畳まない互換漢字 﨑 (U+FA11) を 崎 (U+5D0E) に畳む", () => {
    // NFKC 単体では畳まれないこと自体を固定する。畳まれるようになったら表から外せる
    expect("﨑".normalize("NFKC")).toBe("﨑");
    expect(normalizeName("天﨑滉平")).toBe(normalizeName("天崎滉平"));
    expect(normalizeName("宮﨑雅也")).toBe(normalizeName("宮崎雅也"));
  });

  test("異体字セレクタを除去する (基底文字と同じ文字を指すため)", () => {
    // IVS。葛 + U+E0100
    expect(normalizeName("葛\u{E0100}城")).toBe(normalizeName("葛城"));
    // VS17 より前の VS1–VS16
    expect(normalizeName("辻︀")).toBe(normalizeName("辻"));
  });

  test("常用漢字表の康熙字典体を新字体に寄せる", () => {
    const pairs: Array<[string, string]> = [
      ["齊藤壮馬", "斉藤壮馬"],
      ["齋藤千和", "斎藤千和"],
      ["德井青空", "徳井青空"],
      ["三木眞一郎", "三木真一郎"],
      ["瀨戸麻沙美", "瀬戸麻沙美"],
      ["神谷浩史郞", "神谷浩史郎"],
      ["花澤香菜", "花沢香菜"],
      ["濱野大輝", "浜野大輝"],
      ["渡邊歩", "渡辺歩"],
      ["國府田マリ子", "国府田マリ子"],
      ["廣瀬大介", "広瀬大介"],
      ["曾我部和恭", "曽我部和恭"],
      ["三石琴惠", "三石琴恵"],
      ["未來", "未来"],
      ["淺沼晋太郎", "浅沼晋太郎"],
      ["瀧本富士子", "滝本富士子"],
      ["福山龍之介", "福山竜之介"],
    ];
    for (const [old, modern] of pairs) {
      expect(normalizeName(old), `${old} と ${modern}`).toBe(normalizeName(modern));
    }
  });

  test("常用漢字表に無い人名の異体字も寄せる", () => {
    expect(normalizeName("日髙のり子")).toBe(normalizeName("日高のり子"));
    expect(normalizeName("髙橋孝治")).toBe(normalizeName("高橋孝治"));
    expect(normalizeName("濵野大輝")).toBe(normalizeName("浜野大輝"));
    expect(normalizeName("渡邉歩")).toBe(normalizeName("渡辺歩"));
    // 邉 と 邊 は寄せ先が同じなので互いにも一致する
    expect(normalizeName("渡邉歩")).toBe(normalizeName("渡邊歩"));
    expect(normalizeName("栁田淳一")).toBe(normalizeName("柳田淳一"));
  });

  test("異体字の畳み込みは記号の除去と併用できる", () => {
    expect(normalizeName("天﨑 滉平")).toBe(normalizeName("天崎滉平"));
    expect(normalizeName("髙橋・孝治")).toBe(normalizeName("高橋孝治"));
  });

  test("畳み込みは冪等 (2 回通しても同じ)", () => {
    for (const name of ["天﨑滉平", "日髙のり子", "渡邉歩", "上田麗奈"]) {
      expect(normalizeName(normalizeName(name))).toBe(normalizeName(name));
    }
  });
});

describe("normalizeName が畳んではいけない組", () => {
  test("斉 (U+6589) と 斎 (U+658E) は別の字", () => {
    expect(normalizeName("斉藤壮馬")).not.toBe(normalizeName("斎藤壮馬"));
    // 旧字体どうしも別のまま
    expect(normalizeName("齊藤壮馬")).not.toBe(normalizeName("齋藤壮馬"));
  });

  test("郎 (U+90CE) と 朗 (U+6717) は別の字", () => {
    expect(normalizeName("利根健太郎")).not.toBe(normalizeName("利根健太朗"));
  });

  test("別の姓として使い分けられている異体字は畳まない", () => {
    // 島 / 嶋 / 嶌、富 / 冨、崎 / 嵜、館 / 舘。異体字ではあるが別の姓として通っている
    expect(normalizeName("中島愛")).not.toBe(normalizeName("中嶋愛"));
    expect(normalizeName("中島愛")).not.toBe(normalizeName("中嶌愛"));
    expect(normalizeName("富田美憂")).not.toBe(normalizeName("冨田美憂"));
    expect(normalizeName("宮崎雅也")).not.toBe(normalizeName("宮嵜雅也"));
    expect(normalizeName("立花館")).not.toBe(normalizeName("立花舘"));
  });

  test("字形が似ているだけの別字は畳まない", () => {
    expect(normalizeName("上條千尋")).not.toBe(normalizeName("上絛千尋"));
    expect(normalizeName("佐藤慧")).not.toBe(normalizeName("佐藤恵"));
    expect(normalizeName("野島祐史")).not.toBe(normalizeName("野島裕史"));
    expect(normalizeName("遊左浩二")).not.toBe(normalizeName("遊佐浩二"));
  });

  test("一般の漢字を無差別には畳まない (人名に現れる字だけが対象)", () => {
    // 学(學)・実(實)・栄(榮) なども常用漢字表の康熙字典体だが、表には入れていない
    expect(normalizeName("學")).not.toBe(normalizeName("学"));
    expect(normalizeName("實")).not.toBe(normalizeName("実"));
    expect(normalizeName("榮")).not.toBe(normalizeName("栄"));
  });
});

describe("nameVariantPairs", () => {
  test("寄せ先そのものを異体字として登録していない (無限に連鎖しない)", () => {
    const pairs = nameVariantPairs();
    const variants = new Set(pairs.map(([variant]) => variant));
    for (const [variant, base] of pairs) {
      expect(variants.has(base), `${variant} の寄せ先 ${base} が別の字に畳まれている`).toBe(false);
    }
  });

  test("同じ異体字を 2 通りに寄せていない", () => {
    const pairs = nameVariantPairs();
    expect(new Set(pairs.map(([variant]) => variant)).size).toBe(pairs.length);
  });

  test("表のすべての組が実際に畳まれる", () => {
    for (const [variant, base] of nameVariantPairs()) {
      expect(normalizeName(variant), `${variant} → ${base}`).toBe(normalizeName(base));
    }
  });
});
