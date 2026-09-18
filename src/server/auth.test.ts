import { describe, expect, it } from "vitest";
import {
  ADMIN_COOKIE_NAME,
  adminCookie,
  clearAdminCookie,
  isAdminRequest,
  isAdminToken,
  requireBearer,
  timingSafeEqual,
} from "./auth";

function request(headers: Record<string, string> = {}): Request {
  return new Request("https://example.test/api/admin/ingest", { method: "POST", headers });
}

describe("requireBearer", () => {
  it("トークンが未設定なら 503 を返す", async () => {
    const response = requireBearer(request({ authorization: "Bearer any" }), undefined);
    expect(response?.status).toBe(503);
  });

  it("空文字のトークンも未設定として扱う", () => {
    expect(requireBearer(request(), "")?.status).toBe(503);
  });

  it("ヘッダが無い / 一致しないなら 401 を返す", () => {
    expect(requireBearer(request(), "secret")?.status).toBe(401);
    expect(requireBearer(request({ authorization: "Bearer wrong" }), "secret")?.status).toBe(401);
    // Bearer 以外の方式は受け付けない
    expect(requireBearer(request({ authorization: "Basic secret" }), "secret")?.status).toBe(401);
  });

  it("一致すれば null を返す", () => {
    expect(requireBearer(request({ authorization: "Bearer secret" }), "secret")).toBeNull();
  });
});

describe("isAdminRequest", () => {
  it("ADMIN_TOKEN が未設定なら常に false", () => {
    expect(isAdminRequest(request({ authorization: "Bearer secret" }), {})).toBe(false);
  });

  it("Authorization ヘッダで通る", () => {
    expect(
      isAdminRequest(request({ authorization: "Bearer secret" }), { ADMIN_TOKEN: "secret" }),
    ).toBe(true);
  });

  it("cookie でも通る", () => {
    const req = request({ cookie: `other=x; ${ADMIN_COOKIE_NAME}=secret` });
    expect(isAdminRequest(req, { ADMIN_TOKEN: "secret" })).toBe(true);
  });

  it("cookie の値が違えば false", () => {
    const req = request({ cookie: `${ADMIN_COOKIE_NAME}=wrong` });
    expect(isAdminRequest(req, { ADMIN_TOKEN: "secret" })).toBe(false);
  });

  it("URL エンコードされた cookie も復元して比べる", () => {
    const token = "a b+c";
    const req = request({ cookie: `${ADMIN_COOKIE_NAME}=${encodeURIComponent(token)}` });
    expect(isAdminRequest(req, { ADMIN_TOKEN: token })).toBe(true);
  });
});

describe("adminCookie", () => {
  it("HttpOnly / Secure / SameSite=Lax を付ける", () => {
    const value = adminCookie("secret");
    expect(value).toContain(`${ADMIN_COOKIE_NAME}=secret`);
    expect(value).toContain("HttpOnly");
    expect(value).toContain("Secure");
    expect(value).toContain("SameSite=Lax");
    // server function は /_serverFn/... へ飛ぶので Path は / にする
    expect(value).toContain("Path=/;");
  });

  it("clearAdminCookie は Max-Age=0 で消す", () => {
    expect(clearAdminCookie()).toContain("Max-Age=0");
  });
});

describe("timingSafeEqual", () => {
  it("同じ文字列なら true", () => {
    expect(timingSafeEqual("secret", "secret")).toBe(true);
    expect(timingSafeEqual("", "")).toBe(true);
  });

  /**
   * 長さが違うときに早期 return すると、応答時間から「長さが合っているか」だけが読める。
   * 長い方に合わせて回し切る実装になっていることを、結果の正しさで最低限固定する
   */
  it("長さが違えば false (途中まで一致していても)", () => {
    expect(timingSafeEqual("secret", "secretary")).toBe(false);
    expect(timingSafeEqual("secretary", "secret")).toBe(false);
    expect(timingSafeEqual("", "s")).toBe(false);
  });

  it("同じ長さで中身が違えば false", () => {
    expect(timingSafeEqual("secret", "secreT")).toBe(false);
  });
});

describe("isAdminToken", () => {
  it("ADMIN_TOKEN と一致したときだけ true", () => {
    expect(isAdminToken("s3cret", { ADMIN_TOKEN: "s3cret" })).toBe(true);
    expect(isAdminToken("wrong", { ADMIN_TOKEN: "s3cret" })).toBe(false);
  });

  it("ADMIN_TOKEN が未設定なら常に false", () => {
    expect(isAdminToken("anything", {})).toBe(false);
    expect(isAdminToken("", { ADMIN_TOKEN: "" })).toBe(false);
  });
});
