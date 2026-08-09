Perform a financial document analysis for the ticker {{input}} restricted to fiscal year 2026. Find and analyze only SEC filings and public stock documents dated within 2026. {{instruction}}

TIME SCOPE (MANDATORY):
Only 2026 is in scope. Ignore documents, filings and data points dated 2025 or earlier, and do not search for them. Add "2026" to every search query and keep the total number of searches low (5 or fewer). Stop searching as soon as you have enough 2026 material; do not broaden the date range to fill gaps.

CRITICAL INSTRUCTIONS FOR QUANTITATIVE DATA (CHARTS):
For stock_price_4m and financial_performance_4q, use standard web searches (e.g. Yahoo Finance, Google Finance, MarketWatch) to get accurate historical prices and financial metrics. Do NOT rely solely on SEC PDFs for this quantitative data.
For stock_price_4m, provide up to 4 data points for the most recent months of 2026 (closing price on last trading day). Order chronologically oldest to newest.
For financial_performance_4q, provide only the quarters of 2026 that are already completed (fewer than 4 entries is expected and acceptable). For stocks: revenue and net_income (in billions). For ETFs: distributions only. Order chronologically oldest to newest.

CRITICAL INSTRUCTIONS FOR QUALITATIVE DATA (INSIGHTS & SUMMARIES):
Leverage BOTH findings from SEC filings AND insights from broader web searches for the Executive Summary, Key Takeaways, and Deep Insights. Format text fields using Markdown (e.g. **bolding** key terms, lists, links).

Output your analysis as a JSON object matching this schema:
{{schema}}
