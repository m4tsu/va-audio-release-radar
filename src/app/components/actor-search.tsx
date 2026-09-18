import { Link } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { FollowButton } from "@/app/components/follow-button";
import { Input } from "@/app/components/ui/input";
import { useDebouncedValue } from "@/app/hooks/use-debounced-value";
import type { ActorSummary } from "@/app/lib/view-types";
import { searchActorsFn } from "@/app/server-fns/actors";

/** 入力が止まってから検索するまでの待ち時間。打鍵ごとに DB を引かないため */
const DEBOUNCE_MS = 300;
const RESULT_LIMIT = 8;

/**
 * 声優の検索。企画書 §6 の最初の一歩 (検索 → フォロー) をトップの一番上に置く。
 *
 * 検索はクライアントからしか走らない。SSR には入力欄だけが出る
 */
export function ActorSearch() {
  const inputId = useId();
  const [query, setQuery] = useState("");
  const debounced = useDebouncedValue(query.trim(), DEBOUNCE_MS);
  const [results, setResults] = useState<ActorSummary[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (debounced.length === 0) {
      setResults([]);
      setSearching(false);
      return;
    }

    // 遅れて届いた古い応答で新しい結果を上書きしないようにする
    let current = true;
    setSearching(true);
    searchActorsFn({ data: { q: debounced, limit: RESULT_LIMIT } })
      .then((found) => {
        if (current) setResults(found);
      })
      .catch(() => {
        if (current) setResults([]);
      })
      .finally(() => {
        if (current) setSearching(false);
      });

    return () => {
      current = false;
    };
  }, [debounced]);

  return (
    <section className="space-y-3">
      <label htmlFor={inputId} className="font-medium text-sm">
        声優を探してフォローする
      </label>
      <div className="relative">
        <Search
          aria-hidden="true"
          className="-translate-y-1/2 absolute top-1/2 left-3 size-4 text-muted-foreground"
        />
        <Input
          id={inputId}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="声優名 (例: 上田麗奈)"
          autoComplete="off"
          className="pl-9"
        />
      </div>

      {debounced.length > 0 ? (
        <SearchResults results={results} searching={searching} query={debounced} />
      ) : null}
    </section>
  );
}

function SearchResults({
  results,
  searching,
  query,
}: {
  results: ActorSummary[];
  searching: boolean;
  query: string;
}) {
  if (results.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        {searching ? "検索中…" : `「${query}」に一致する声優は見つかりませんでした。`}
      </p>
    );
  }

  return (
    <ul aria-label="検索結果" className="divide-y rounded-xl border bg-card">
      {results.map((actor) => (
        <li key={actor.id} className="flex items-center justify-between gap-3 px-4 py-3">
          <Link
            to="/voice-actors/$slug"
            params={{ slug: actor.slug }}
            className="min-w-0 hover:underline"
          >
            <span className="font-medium">{actor.canonicalName}</span>
            {actor.nameKana ? (
              <span className="ml-2 text-muted-foreground text-xs">{actor.nameKana}</span>
            ) : null}
            <span className="ml-2 text-muted-foreground text-xs">{actor.workCount} 作品</span>
          </Link>
          <FollowButton
            actor={{
              voiceActorId: actor.id,
              slug: actor.slug,
              canonicalName: actor.canonicalName,
            }}
          />
        </li>
      ))}
    </ul>
  );
}
