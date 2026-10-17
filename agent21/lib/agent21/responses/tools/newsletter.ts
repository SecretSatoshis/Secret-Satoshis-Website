import { sourcesBlock } from "../blocks";
import { fetchJson, SourceError } from "../data/http";
import { opt, s, tool } from "./types";

// The Secret Satoshis newsletter, read live (the agent21-secret-satoshis
// skill). Posts are background for answers, or the answer when asked about.
const NEWSLETTER = "https://newsletter.secretsatoshis.com";
type Post = {
  title: string;
  subtitle?: string;
  slug: string;
  post_date: string;
  body_html?: string;
};

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};
/** An article's readable text: paragraphs and list items on their own lines. */
export function htmlText(html: string) {
  return html
    .replace(/<(script|style|figure|svg)[\s\S]*?<\/\1>/gi, "")
    .replace(/<(br|\/p|\/h\d|\/li|\/blockquote|\/tr)\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, code: string) => {
      if (code[0] !== "#") return ENTITIES[code.toLowerCase()] ?? m;
      const n =
        code[1] === "x" || code[1] === "X"
          ? parseInt(code.slice(2), 16)
          : Number(code.slice(1));
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    })
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}
const brief = (p: Post) => ({
  title: p.title,
  subtitle: p.subtitle ?? null,
  slug: p.slug,
  published: p.post_date.slice(0, 10),
  url: `${NEWSLETTER}/p/${p.slug}`,
});

export const newsletter = tool<{
  action: "latest" | "search" | "post";
  query: string | null;
  slug: string | null;
  limit: number | null;
}>({
  name: "newsletter",
  label: "Checking a data source",
  description:
    "The Secret Satoshis newsletter. latest: the newest posts (weekly recaps are 'Weekly Bitcoin Recap - Week N, YYYY'). search: posts matching words, such as 'price outlook' (results are not in date order). post: one article's text by slug (start-here is the Start Here guide). Never use web search for a Secret Satoshis article.",
  parameters: s.object({
    action: s.oneOf(["latest", "search", "post"], "What to do"),
    query: s.nullable(s.str("Search words, for search")),
    slug: s.nullable(s.str("Post slug, for post")),
    limit: s.nullable(s.int("Posts to list, up to 50 (default 12)")),
  }),
  async run(args, { log }) {
    if (args.action === "post") {
      const slug = opt(args.slug);
      if (!slug || !/^[a-z0-9-]{1,200}$/.test(slug))
        throw new SourceError("post needs a slug");
      const post = await fetchJson<Post>(`${NEWSLETTER}/api/v1/posts/${slug}`, {
        log,
        maxBytes: 4 * 1024 ** 2,
      });
      const text = htmlText(post.body_html ?? "");
      return {
        ...brief(post),
        text: text.slice(0, 14_000),
        ...(text.length > 14_000
          ? { note: `First 14,000 of ${text.length} characters.` }
          : {}),
        blocks: {
          sources: sourcesBlock([
            {
              name: "Secret Satoshis",
              detail: post.title.slice(0, 60),
              url: brief(post).url,
              published: brief(post).published,
            },
          ]),
        },
      };
    }
    const params = new URLSearchParams({
      sort: "new",
      limit: String(Math.min(Math.max(args.limit ?? 12, 1), 50)),
    });
    if (args.action === "search") {
      if (!args.query?.trim()) throw new SourceError("search needs words");
      params.set("search", args.query.trim());
    }
    const posts = await fetchJson<Post[]>(
      `${NEWSLETTER}/api/v1/archive?${params}`,
      { log },
    );
    const listed = posts.map(brief);
    if (args.action === "search")
      listed.sort((a, b) => b.published.localeCompare(a.published));
    return { posts: listed };
  },
});
