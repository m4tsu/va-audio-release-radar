import { describe, expect, test } from "vitest";
import {
  INQUIRY_BODY_MAX_LENGTH,
  INQUIRY_CONTACT_MAX_LENGTH,
  inquirySubmissionSchema,
  PUSH_SUBSCRIPTION_MAX_ACTORS,
  pushSubscriptionSchema,
  pushUnsubscribeSchema,
} from "./public-api.ts";

describe("inquirySubmissionSchema", () => {
  test("種別・本文・連絡先が揃った送信を受け付ける", () => {
    const result = inquirySubmissionSchema.safeParse({
      kind: "bug",
      body: "声優ページが開けない",
      contact: "user@example.com",
    });
    expect(result.success && result.data).toEqual({
      kind: "bug",
      body: "声優ページが開けない",
      contact: "user@example.com",
    });
  });

  test("連絡先は省いても空でも通り、どちらも未記入になる", () => {
    for (const submission of [
      { kind: "request", body: "ストアを増やしてほしい" },
      { kind: "request", body: "ストアを増やしてほしい", contact: "" },
      // 未記入の欄はブラウザから空白のまま届くことがある
      { kind: "request", body: "ストアを増やしてほしい", contact: "   " },
    ]) {
      const result = inquirySubmissionSchema.safeParse(submission);
      expect(result.success).toBe(true);
      expect(result.success && result.data.contact).toBeUndefined();
    }
  });

  test("本文が空、または空白だけなら拒否する", () => {
    for (const body of ["", " ", "\n\t "]) {
      expect(inquirySubmissionSchema.safeParse({ kind: "other", body }).success).toBe(false);
    }
  });

  test("本文は上限ちょうどまで通り、超えると拒否する", () => {
    const limit = "あ".repeat(INQUIRY_BODY_MAX_LENGTH);
    expect(inquirySubmissionSchema.safeParse({ kind: "other", body: limit }).success).toBe(true);
    expect(inquirySubmissionSchema.safeParse({ kind: "other", body: `${limit}あ` }).success).toBe(
      false,
    );
  });

  test("長さは前後の空白を落としてから見る", () => {
    // 空白ぶんで弾かれると、画面に出ている文字数と拒否の基準がずれる
    const body = ` ${"あ".repeat(INQUIRY_BODY_MAX_LENGTH)} `;
    const result = inquirySubmissionSchema.safeParse({ kind: "other", body });
    expect(result.success && result.data.body.length).toBe(INQUIRY_BODY_MAX_LENGTH);
  });

  test("連絡先も上限を超えれば拒否する", () => {
    const contact = "a".repeat(INQUIRY_CONTACT_MAX_LENGTH + 1);
    expect(
      inquirySubmissionSchema.safeParse({ kind: "other", body: "本文", contact }).success,
    ).toBe(false);
  });

  test("種別が選択肢に無ければ拒否する", () => {
    expect(inquirySubmissionSchema.safeParse({ kind: "question", body: "本文" }).success).toBe(
      false,
    );
    expect(inquirySubmissionSchema.safeParse({ body: "本文" }).success).toBe(false);
  });
});

describe("pushSubscriptionSchema", () => {
  function validSubscription() {
    return {
      endpoint: "https://push.example/sub/abc",
      p256dh:
        "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM",
      auth: "tBHItJI5svbpez7KI4CCXg",
      locale: "ja",
      voiceActorIds: ["va_ueda-reina"],
    };
  }

  test("ブラウザが返す形の購読を受け付ける", () => {
    expect(pushSubscriptionSchema.safeParse(validSubscription()).success).toBe(true);
  });

  test("フォローが 0 件でも受け付ける", () => {
    const result = pushSubscriptionSchema.safeParse({ ...validSubscription(), voiceActorIds: [] });
    expect(result.success).toBe(true);
  });

  /** 宛先はそのまま fetch するので、http や別のスキームを通さない */
  test("endpoint は https のみ", () => {
    for (const endpoint of ["http://push.example/sub", "javascript:alert(1)", "not a url"]) {
      expect(pushSubscriptionSchema.safeParse({ ...validSubscription(), endpoint }).success).toBe(
        false,
      );
      expect(pushUnsubscribeSchema.safeParse({ endpoint }).success).toBe(false);
    }
    expect(
      pushUnsubscribeSchema.safeParse({ endpoint: validSubscription().endpoint }).success,
    ).toBe(true);
  });

  test("鍵は base64url の文字だけ", () => {
    expect(
      pushSubscriptionSchema.safeParse({ ...validSubscription(), p256dh: "not+base64url/==" })
        .success,
    ).toBe(false);
    expect(pushSubscriptionSchema.safeParse({ ...validSubscription(), auth: "" }).success).toBe(
      false,
    );
  });

  test("対応していない言語は弾く", () => {
    expect(pushSubscriptionSchema.safeParse({ ...validSubscription(), locale: "fr" }).success).toBe(
      false,
    );
  });

  test("追う声優は上限を超えると弾く", () => {
    const voiceActorIds = Array.from(
      { length: PUSH_SUBSCRIPTION_MAX_ACTORS + 1 },
      (_, index) => `va_${index}`,
    );
    expect(
      pushSubscriptionSchema.safeParse({ ...validSubscription(), voiceActorIds }).success,
    ).toBe(false);
  });
});
