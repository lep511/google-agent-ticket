Produce a market news digest for {{input}}. Search the recent news cycle for {{input}}, prioritising the last 30 days and never going further back than 90 days, and identify the coverage that actually moves the story: company announcements, earnings and guidance, analyst and market reaction, and sector, regulatory or supply chain context. {{instruction}}

CRITICAL INSTRUCTIONS FOR COVERAGE:
Use the `google_search` tool for every claim you report. Consult at least 6 distinct sources from different publishers and prefer primary sources (company press releases, regulatory notices, official statements) over aggregators when both cover the same fact.
Group the cycle into themes rather than listing headlines one by one, and state explicitly when the coverage on a theme is thin or contradictory.
Separate confirmed facts from speculation, rumour and opinion. Attribute every forward-looking statement to whoever made it.
Assess the overall tone of the cycle (clearly positive, mixed, clearly negative) and justify it with the coverage you found, not with prior knowledge.

CRITICAL INSTRUCTIONS FOR THE WRITE-UP:
Write `summary` as a short executive digest of the cycle, including the overall tone.
Write between 3 and 6 `key_points`, each one a single self-contained takeaway.
Use `sections` for the themes of the cycle, one object per theme, with a descriptive `title` and a `body` that explains what happened and why it matters.
List in `sources` every source you actually consulted, with its `title`, its `url` and its publication `date` in `YYYY-MM-DD` format. Do not invent URLs or dates: if you cannot confirm a date, omit that source.
Format text fields (`summary`, `key_points` items, `body`) using Markdown (e.g. **bolding** key terms, lists, links, inline code) so cards display rich, formatted content.

CRITICAL: You MUST output the final digest as a raw JSON object wrapped in a ```json ... ``` markdown block in your final text response. The JSON must match the following schema EXACTLY. **HEAVILY PENALIZED:** Do NOT rename keys. Do NOT add extra root-level keys. Use exactly the root keys "summary", "key_points", "sections" and "sources", exactly the keys "title" and "body" in every section, and exactly the keys "title", "url" and "date" in every source:
{{schema}}
Do not include multiple sub-agents, just do the research and the synthesis yourself based on your searches.
