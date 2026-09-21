import { describe, expect, test } from "vitest";
import { webManifest } from "./manifest";

describe("webManifest", () => {
  test("ホーム画面から開くとフォロー一覧に着き、単独のアプリとして開く", () => {
    const manifest = webManifest("ja");

    expect(manifest.start_url).toBe("/following");
    expect(manifest.display).toBe("standalone");
    expect(manifest.icons.map((icon) => icon.sizes)).toEqual(["192x192", "512x512"]);
  });

  /** 名前はブランドなので言語で変えない。説明文だけが言語に追従する */
  test("名前は両言語で同じで、説明文と lang は言語に追従する", () => {
    const ja = webManifest("ja");
    const en = webManifest("en");

    expect(en.name).toBe(ja.name);
    expect(en.description).not.toBe(ja.description);
    expect(ja.lang).toBe("ja");
    expect(en.lang).toBe("en");
  });
});
