// Real charges from the OpenAI Costs API, by UTC day and line item. Needs
// OPENAI_ADMIN_KEY; OPENAI_PROJECT_ID limits it to this project. Charges lag by
// up to a day. Used by `pnpm ops report` and `pnpm evals report --reconcile`.
export type DailyCosts =
  | { status: "not_configured" }
  | { status: "unavailable"; httpStatus: number }
  | {
      status: "available";
      scope: "project" | "organization";
      days: Map<string, Record<string, number>>;
    };

/** Costs per UTC day and line item from `start` (seconds) up to `end`. */
export async function dailyCosts(
  start: number,
  end?: number,
): Promise<DailyCosts> {
  const key = process.env.OPENAI_ADMIN_KEY;
  if (!key) return { status: "not_configured" };
  const days = new Map<string, Record<string, number>>();
  let page: string | undefined;
  do {
    const url = new URL("https://api.openai.com/v1/organization/costs");
    url.searchParams.set("start_time", String(start));
    if (end) url.searchParams.set("end_time", String(end));
    url.searchParams.set("bucket_width", "1d");
    url.searchParams.set("limit", "31");
    url.searchParams.append("group_by", "line_item");
    if (process.env.OPENAI_PROJECT_ID)
      url.searchParams.append("project_ids", process.env.OPENAI_PROJECT_ID);
    if (page) url.searchParams.set("page", page);
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!response.ok)
      return { status: "unavailable", httpStatus: response.status };
    const body = (await response.json()) as {
      data: {
        start_time: number;
        results: { amount: { value: number }; line_item: string | null }[];
      }[];
      has_more: boolean;
      next_page: string | null;
    };
    for (const bucket of body.data) {
      const day = new Date(bucket.start_time * 1000).toISOString().slice(0, 10);
      const items = days.get(day) ?? {};
      for (const result of bucket.results)
        items[result.line_item ?? "other"] =
          (items[result.line_item ?? "other"] ?? 0) + result.amount.value;
      days.set(day, items);
    }
    page = body.has_more ? (body.next_page ?? undefined) : undefined;
  } while (page);
  return {
    status: "available",
    scope: process.env.OPENAI_PROJECT_ID ? "project" : "organization",
    days,
  };
}
