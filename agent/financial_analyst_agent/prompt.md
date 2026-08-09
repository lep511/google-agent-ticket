Perform a comprehensive financial document analysis for the ticker {{input}}. Find and analyze recent SEC filings and public stock documents. {{instruction}}

CRITICAL INSTRUCTIONS FOR QUANTITATIVE DATA (CHARTS):
For stock_price_4m and financial_performance_4q, use standard web searches (e.g. Yahoo Finance, Google Finance, MarketWatch) to get accurate historical prices and financial metrics. Do NOT rely solely on SEC PDFs for this quantitative data.
For stock_price_4m, provide exactly 4 data points for the past 4 months (closing price on last trading day). Order chronologically oldest to newest.
For financial_performance_4q, provide the last 4 completed quarters. For stocks: revenue and net_income (in billions). For ETFs: distributions only. Order chronologically oldest to newest.

CRITICAL INSTRUCTIONS FOR QUALITATIVE DATA (INSIGHTS & SUMMARIES):
Leverage BOTH findings from SEC filings AND insights from broader web searches for the Executive Summary, Key Takeaways, and Deep Insights. Format text fields using Markdown (e.g. **bolding** key terms, lists, links).

Output your analysis as a JSON object matching this schema:
{{schema}}
