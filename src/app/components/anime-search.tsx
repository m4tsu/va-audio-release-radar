import { Link } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { Input } from "@/app/components/ui/input";
import { useDebouncedValue } from "@/app/hooks/use-debounced-value";
import { useLocale, useT } from "@/app/i18n";
import { animeDisplayTitle } from "@/app/lib/anime-title";
import { seasonLabel } from "@/app/lib/season";
import type { AnimeSummary } from "@/app/lib/view-types";
import { searchAnimeFn } from "@/app/server-fns/anime";

/** 入力が止まってから検索するまでの待ち時間。打鍵ごとに DB を引かないため (声優検索と同じ) */
const DEBOUNCE_MS = 300;
const RESULT_LIMIT = 8;

/**
 * アニメ名の検索。シーズンを選ぶ経路だけでは、放送時期を覚えていない人が辿り着けない。
 *
 * 検索はクライアントからしか走らない。SSR には入力欄だけが出る (`actor-search.tsx` と同じ)
 */
export function AnimeSearch() {
  const t = useT();
  const inputId = useId();
  const [query, setQuery] = useState("");
  const debounced = useDebouncedValue(query.trim(), DEBOUNCE_MS);
  const [results, setResults] = useState<AnimeSummary[]>([]);
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
    searchAnimeFn({ data: { q: debounced, limit: RESULT_LIMIT } })
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
        {t("anime.searchLabel")}
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
  results: AnimeSummary[];
  searching: boolean;
  query: string;
}) {
  const t = useT();
  const locale = useLocale();

  if (results.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        {searching ? t("search.searching") : t("anime.searchNoResults", { query })}
      </p>
    );
  }

  return (
    <ul aria-label={t("search.resultsLabel")} className="divide-y rounded-xl border bg-card">
      {results.map((anime) => (
        <li key={anime.slug}>
          <Link
            to="/anime/$slug"
            params={{ slug: anime.slug }}
            className="flex flex-wrap items-baseline gap-x-2 px-4 py-3"
          >
            <span className="link-text font-medium">{animeDisplayTitle(anime, locale)}</span>
            <span className="text-muted-foreground text-xs">
              {seasonLabel(anime.seasonYear, anime.season, locale)}
            </span>
            <span className="text-muted-foreground text-xs">
              {t("anime.actorCount", { count: anime.actorCount })}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
