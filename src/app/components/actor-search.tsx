import { Link } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { FollowButton } from "@/app/components/follow-button";
import { Input } from "@/app/components/ui/input";
import { useDebouncedValue } from "@/app/hooks/use-debounced-value";
import { useLocale, useT } from "@/app/i18n";
import { actorDisplayName } from "@/app/lib/actor-name";
import type { ActorSummary } from "@/app/lib/view-types";
import { searchActorsFn } from "@/app/server-fns/actors";

/** 入力が止まってから検索するまでの待ち時間。打鍵ごとに DB を引かないため */
const DEBOUNCE_MS = 300;
const RESULT_LIMIT = 8;

/**
 * 声優の検索。最初の一歩 (検索 → フォロー) をトップの一番上に置く。
 *
 * 検索はクライアントからしか走らない。SSR には入力欄だけが出る
 */
export function ActorSearch() {
  const t = useT();
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
        {t("search.label")}
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
  const t = useT();
  const locale = useLocale();

  if (results.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        {searching ? t("search.searching") : t("search.noResults", { query })}
      </p>
    );
  }

  return (
    <ul aria-label={t("search.resultsLabel")} className="divide-y rounded-xl border bg-card">
      {results.map((actor) => (
        <li key={actor.id} className="flex items-center justify-between gap-3 px-4 py-3">
          <Link
            to="/voice-actors/$slug"
            params={{ slug: actor.slug }}
            className="min-w-0 hover:underline"
          >
            <span className="font-medium">{actorDisplayName(actor, locale)}</span>
            {actor.nameKana ? (
              <span className="ml-2 text-muted-foreground text-xs">{actor.nameKana}</span>
            ) : null}
            <span className="ml-2 text-muted-foreground text-xs">
              {t("common.worksCount", { count: actor.workCount })}
            </span>
          </Link>
          <FollowButton
            actor={{
              voiceActorId: actor.id,
              slug: actor.slug,
              canonicalName: actor.canonicalName,
              ...(actor.nameEn ? { nameEn: actor.nameEn } : {}),
            }}
          />
        </li>
      ))}
    </ul>
  );
}
