import type { EntityTable } from "dexie";
import { create } from "zustand";

/**
 * フォロー状態 (企画書 §16)。アカウントを作らせないので、ブラウザの IndexedDB にだけ持つ。
 *
 * SSR では何も読めないため、サーバーでは常に `status: "idle"` / 空配列で描画し、
 * クライアントがマウントしてから `init()` で読み込む。初期状態がサーバーと
 * クライアントで同じなので hydration の不一致にならない
 */

/** IndexedDB のデータベース名。バージョンはテーブルの物理スキーマ用 */
const DB_NAME = "voice-actor-audio-release-radar";

export type FollowedActor = {
  voiceActorId: string;
  slug: string;
  canonicalName: string;
  /** フォローした日時 (ISO 8601)。一覧を「追加した順」で並べるために持つ */
  createdAt: string;
};

/** フォローするときに画面から渡すもの。createdAt はストアが埋める */
export type FollowTarget = Omit<FollowedActor, "createdAt">;

type FollowState = {
  status: "idle" | "ready";
  /** createdAt の新しい順 */
  follows: FollowedActor[];
  init: () => Promise<void>;
  follow: (actor: FollowTarget) => Promise<void>;
  unfollow: (voiceActorId: string) => Promise<void>;
  isFollowing: (voiceActorId: string) => boolean;
};

/**
 * Dexie の読み込みは init() の中でだけ行う。
 * SSR のバンドルに IndexedDB 前提のコードを入れないため、静的 import にしない
 */
let tablePromise: Promise<EntityTable<FollowedActor, "voiceActorId">> | null = null;

function followsTable(): Promise<EntityTable<FollowedActor, "voiceActorId">> {
  tablePromise ??= (async () => {
    const { default: Dexie } = await import("dexie");
    const db = new Dexie(DB_NAME);
    // 主キーは声優 ID。createdAt は並べ替え用の索引
    db.version(1).stores({ follows: "voiceActorId, createdAt" });
    return db.table<FollowedActor, string>("follows");
  })();
  return tablePromise;
}

/** init() の多重実行を防ぐ。ルートの useEffect は開発時の StrictMode で 2 回走る */
let initPromise: Promise<void> | null = null;

function byNewest(a: FollowedActor, b: FollowedActor): number {
  if (a.createdAt === b.createdAt) return a.canonicalName < b.canonicalName ? -1 : 1;
  return a.createdAt < b.createdAt ? 1 : -1;
}

export const useFollowStore = create<FollowState>((set, get) => ({
  status: "idle",
  follows: [],

  init: async () => {
    // サーバーでは IndexedDB が無い。呼ばれても何もしないでおく (呼び出し側の分岐を減らす)
    if (typeof window === "undefined") return;
    initPromise ??= (async () => {
      try {
        const table = await followsTable();
        const rows = await table.toArray();
        set({ follows: rows.sort(byNewest), status: "ready" });
      } catch {
        // プライベートモードなどで IndexedDB が使えない場合。
        // 読めないだけなので、フォロー 0 件として画面は動かす
        set({ status: "ready" });
      }
    })();
    return initPromise;
  },

  follow: async (actor) => {
    const entry: FollowedActor = { ...actor, createdAt: new Date().toISOString() };
    // 先に画面へ反映する。保存が遅い / 失敗する環境でもボタンの反応を落とさない
    set((state) => ({
      follows: [entry, ...state.follows.filter((f) => f.voiceActorId !== entry.voiceActorId)],
    }));
    try {
      const table = await followsTable();
      await table.put(entry);
    } catch {
      // 保存できなくてもこのセッション中は動く。次回訪問時に消えるだけ
    }
  },

  unfollow: async (voiceActorId) => {
    set((state) => ({ follows: state.follows.filter((f) => f.voiceActorId !== voiceActorId) }));
    try {
      const table = await followsTable();
      await table.delete(voiceActorId);
    } catch {
      // 同上
    }
  },

  isFollowing: (voiceActorId) => get().follows.some((f) => f.voiceActorId === voiceActorId),
}));

/** 1 人分の購読。`follows` 全体を購読すると無関係な増減でも再描画されるため分けている */
export function useIsFollowing(voiceActorId: string): boolean {
  return useFollowStore((state) => state.follows.some((f) => f.voiceActorId === voiceActorId));
}

/** テスト用。モジュールに溜まった Dexie のハンドルと init の実行済み状態を捨てる */
export function resetFollowStoreForTest(): void {
  tablePromise = null;
  initPromise = null;
  useFollowStore.setState({ status: "idle", follows: [] });
}
