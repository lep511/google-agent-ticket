Build a corporate profile for {{input}}. First resolve {{input}} to one specific company, then research how that business actually works: its business model and revenue streams, its reporting segments and geographies, its direct competitors and the basis on which they compete, and the structural risks that shape its outlook. {{instruction}}

CRITICAL INSTRUCTIONS FOR THE RESEARCH:
Use the `google_search` tool for every claim you report. Consult at least 6 distinct sources from different publishers and prefer primary sources (annual reports, regulatory filings, investor presentations, the company's own site) over secondary coverage when both cover the same fact.
State explicitly which entity you profiled, including its ticker or country of incorporation when you can confirm them, and list the alternatives you discarded when the input matches several companies.
Cover the profile dimension by dimension: business model and unit economics, segment and geographic mix with any concentration, named competitors and the basis of competition, structural risks (customer or supplier concentration, regulation and litigation, capital intensity, technological substitution, cyclicality), and scale (latest reported revenue, headcount, main markets, ownership structure).
Name competitors only when a source names them as competitors, and attach the fiscal period to every figure you report.
Describe durable characteristics of the business rather than the day's news, and say plainly when a dimension is unsourced or the company is barely covered instead of filling the gap from prior knowledge.

CRITICAL INSTRUCTIONS FOR THE WRITE-UP:
Write `summary` as a short executive profile of the company, naming the entity you profiled.
Write between 3 and 6 `key_points`, each one a single self-contained takeaway.
Use `sections` for the dimensions of the profile, one object per dimension, with a descriptive `title` and a `body` that explains what the evidence says and why it matters.
List in `sources` every source you actually consulted, with its `title`, its `url` and its publication `date` in `YYYY-MM-DD` format. Do not invent URLs or dates: if you cannot confirm a date, omit that source.
Format text fields (`summary`, `key_points` items, `body`) using Markdown (e.g. **bolding** key terms, lists, links, inline code) so cards display rich, formatted content.

CRITICAL: You MUST output the final profile as a raw JSON object wrapped in a ```json ... ``` markdown block in your final text response. The JSON must match the following schema EXACTLY. **HEAVILY PENALIZED:** Do NOT rename keys. Do NOT add extra root-level keys. Use exactly the root keys "summary", "key_points", "sections" and "sources", exactly the keys "title" and "body" in every section, and exactly the keys "title", "url" and "date" in every source:
{{schema}}
Do not include multiple sub-agents, just do the research and the synthesis yourself based on your searches.
