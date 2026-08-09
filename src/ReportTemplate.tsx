import React from 'react';
import { 
  X, FileText, CheckCircle2, ChevronRight, Link as LinkIcon, Calendar
, TrendingUp, TrendingDown, Minus, Lightbulb, AlertTriangle, Printer} from 'lucide-react';
import { DeepInsight, DocumentFinding, ReportData } from './App';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, Legend } from 'recharts';
import { FormattedMarkdown } from './components/FormattedMarkdown';

interface Props {
  data: ReportData;
  ticker: string;
  onClose: () => void;
  durationSecs?: number;
  toolRuns?: number;
  tokenCount?: number;
  documentCount?: number;
}

const AnalysisCard = ({ title, subtext, children, className = "" }: any) => (
  <div className={`bg-white rounded-xl p-6 border border-stone-200 flex flex-col print:break-inside-avoid print:mb-6 print:shadow-none print:bg-white print:border-stone-300 ${className}`}>
    <div className="flex justify-between items-start mb-2 print:break-after-avoid print-keep-with-next">
      <h3 className="text-lg font-semibold text-stone-900">{title}</h3>
    </div>
    {subtext && (
      <div className="text-stone-700 text-[15px] mb-6 print:mb-4">
        {subtext}
      </div>
    )}
    <div className="flex-1 w-full flex flex-col">
      {children}
    </div>
  </div>
);

export default function ReportTemplate({ data, ticker, onClose, durationSecs = 0, toolRuns = 0, tokenCount = 0, documentCount = 0 }: Props) {
  const scoreColor = (score: number) => {
    if (score >= 80) return 'text-[#0b5a4b]';
    if (score >= 60) return 'text-blue-600';
    if (score >= 40) return 'text-yellow-600';
    return 'text-red-600';
  };

  /*
    The report is JSON the model wrote, so its shape is a hope, not a guarantee.
    `findings` typed as an array is not enough: a model that answers with an
    object or a string there used to reach `.filter` and throw during render,
    which blanked the whole report instead of degrading to the empty state below.
  */
  const findings: DocumentFinding[] = Array.isArray(data.findings) ? data.findings : [];
  const deepInsights: DeepInsight[] = Array.isArray(data.deep_insights) ? data.deep_insights : [];
  
  return (
    <div className="min-h-full bg-[#F6F4F0] text-stone-900 font-sans w-full flex flex-col h-full overflow-y-auto print:h-auto print:overflow-visible print:bg-white print:p-0">
      <div className="w-full border-b border-stone-200 px-[40px] py-4 flex items-center justify-between sticky top-0 z-50 bg-[#F6F4F0] print:hidden">
        <div className="font-display uppercase font-bold text-stone-900 text-lg tracking-wider flex items-center gap-2">
          {ticker} Document Analysis
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={() => window.print()}
            className="flex items-center gap-2 px-3.5 py-2 bg-stone-900 hover:bg-stone-800 text-white rounded-lg font-medium text-xs tracking-wide transition-all shadow-sm cursor-pointer active:scale-95"
            title="Save report as PDF or Print"
          >
            <Printer className="w-4 h-4" />
            <span>Save as PDF / Print</span>
          </button>
          <button 
            onClick={onClose}
            className="text-stone-500 hover:text-stone-900 hover:bg-stone-200/80 active:bg-stone-300 rounded-full transition-all flex items-center justify-center p-2 cursor-pointer"
            title="Close report"
          >
            <X className="w-6 h-6" />
          </button>
        </div>
      </div>

      <div className="flex-1 py-8 px-[40px] w-full max-w-[1200px] mx-auto flex flex-col gap-6 print:py-0 print:px-0 print:max-w-none print:w-full print:block print:gap-0">
        
        {/* Print Header */}
        <div className="hidden print:flex items-center justify-between border-b-2 border-stone-800 pb-4 mb-6 w-full print:break-after-avoid">
          <div>
            <h1 className="font-display uppercase font-bold text-stone-900 text-3xl tracking-wider">
              {ticker} Document Analysis Report
            </h1>
            <div className="text-xs text-stone-600 font-mono mt-1">
              Generated on {new Date().toLocaleDateString()}
            </div>
          </div>
          <div className="text-right">
            <div className="font-display font-bold text-xl text-stone-900 uppercase tracking-wide">Tickr</div>
            <div className="text-xs text-stone-600">Financial Intelligence</div>
          </div>
        </div>

        {/* Executive Summary */}
        <div className="flex flex-col gap-6 print:gap-4 print:mb-8 print:w-full">
          <AnalysisCard title="Executive Summary" className="w-full print:block print:w-full print:mb-6">
            <div className="bg-stone-50 p-5 rounded-xl border border-stone-100 mb-6 text-stone-800 leading-relaxed font-medium text-lg w-full print:bg-stone-100/60 print:border-stone-200 print:mb-6">
              <FormattedMarkdown content={data.verdict?.summary || 'No summary available.'} />
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-10 gap-8 w-full mt-2 print:flex print:flex-row print:gap-6 print:w-full print:items-start">
              <div className="md:col-span-7 flex flex-col print:w-7/12 print:flex-1">
                {data.verdict?.key_takeaways && (Array.isArray(data.verdict.key_takeaways) ? data.verdict.key_takeaways.length > 0 : true) && (
                  <div className="w-full text-left flex-1">
                     <div className="text-sm font-bold text-stone-500 uppercase tracking-wider mb-4 border-b border-stone-100 pb-2 print:border-stone-200 print-keep-with-next">Key Takeaways</div>
                     <div className="space-y-3">
                       {Array.isArray(data.verdict.key_takeaways) ? data.verdict.key_takeaways.map((takeaway, i) => (
                          <div key={i} className="flex gap-3 text-base print:break-inside-avoid">
                             <CheckCircle2 className="w-5 h-5 text-[#0b5a4b] shrink-0 mt-0.5" />
                             <FormattedMarkdown content={takeaway} className="flex-1 text-stone-700 leading-relaxed" />
                          </div>
                       )) : (
                          <div className="flex gap-3 text-base print:break-inside-avoid">
                             <CheckCircle2 className="w-5 h-5 text-[#0b5a4b] shrink-0 mt-0.5" />
                             <FormattedMarkdown content={String(data.verdict.key_takeaways)} className="flex-1 text-stone-700 leading-relaxed" />
                          </div>
                       )}
                     </div>
                  </div>
                )}
              </div>
              
              <div className="md:col-span-3 flex flex-col h-full text-center md:border-l md:border-stone-100 md:pl-8 print:w-5/12 print:border-l print:border-stone-200 print:pl-6 print:h-auto shrink-0">
                 <h4 className="text-sm font-bold text-stone-500 uppercase tracking-wider mb-1">Conviction Score</h4>
                 <p className="text-xs text-stone-400 mb-2">Based on analyzed filings</p>
                 <div className={`text-6xl font-display font-bold my-2 flex items-center justify-center ${data.verdict ? scoreColor(data.verdict.conviction_score) : 'text-stone-400'}`}>
                    {data.verdict?.conviction_score || '-'}
                 </div>
                 
                 <div className="text-xs text-stone-500 uppercase tracking-widest font-bold mb-4">out of 100</div>
                 <div className="grid grid-cols-4 gap-1 border-t border-stone-100 pt-4 mt-4 w-full print:border-stone-200">
                   <div className="flex flex-col items-center">
                     <div className="text-[10px] text-stone-500 uppercase font-bold tracking-wider mb-1">Docs</div>
                     <div className="text-sm font-mono text-stone-800">{documentCount}</div>
                   </div>
                   <div className="flex flex-col items-center border-l border-stone-100 print:border-stone-200">
                     <div className="text-[10px] text-stone-500 uppercase font-bold tracking-wider mb-1">Time</div>
                     <div className="text-sm font-mono text-stone-800">{durationSecs}s</div>
                   </div>
                   <div className="flex flex-col items-center border-l border-stone-100 print:border-stone-200">
                     <div className="text-[10px] text-stone-500 uppercase font-bold tracking-wider mb-1">Runs</div>
                     <div className="text-sm font-mono text-stone-800">{toolRuns}</div>
                   </div>
                   <div className="flex flex-col items-center border-l border-stone-100 print:border-stone-200">
                     <div className="text-[10px] text-stone-500 uppercase font-bold tracking-wider mb-1">Tokens</div>
                     <div className="text-sm font-mono text-stone-800">
                        {tokenCount > 0 ? (tokenCount / 1000).toFixed(1) + 'k' : '-'}
                     </div>
                   </div>
                 </div>
              </div>
            </div>
          </AnalysisCard>
        </div>

        {/* Financial Charts */}
        {data.financial_charts && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-8 print:mt-8 print:block print:w-full print:clear-both print:break-before-auto">
            <AnalysisCard title="Stock Price" subtext="This chart shows the closing price on the last trading date for the most recent months of 2026." className="print:break-inside-avoid print:w-full print:mb-6">
              <div className="h-64 mt-4 print:h-64 print:w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data.financial_charts.stock_price_4m ? [...data.financial_charts.stock_price_4m] : []}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e5e4" />
                    <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#78716c' }} dy={10} />
                    <YAxis domain={['auto', 'auto']} axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#78716c' }} dx={-10} />
                    <RechartsTooltip 
                      contentStyle={{ borderRadius: '8px', border: '1px solid #e5e5e4', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                      formatter={(value: number) => [`$${value}`, 'Price']}
                    />
                    <Line type="linear" dataKey="price" stroke="#0b5a4b" strokeWidth={2} dot={{ r: 4, fill: '#0b5a4b', strokeWidth: 0 }} activeDot={{ r: 6 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </AnalysisCard>
            
            <AnalysisCard 
              title="Financial Performance"
              subtext={data.financial_charts.financial_performance_4q && data.financial_charts.financial_performance_4q.length > 0 && data.financial_charts.financial_performance_4q[0].distributions !== undefined ? "This chart shows the quarterly distributions (dividends/yield per share) for the completed quarters of 2026." : "This chart shows the revenue and net income for the completed quarters of 2026."}
              className="print:break-inside-avoid print:w-full print:mb-6"
            >
              <div className="h-64 mt-4 print:h-64 print:w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.financial_charts.financial_performance_4q ? [...data.financial_charts.financial_performance_4q] : []}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e5e4" />
                    <XAxis dataKey="quarter" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#78716c' }} dy={10} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#78716c' }} dx={-10} tickFormatter={(value) => data.financial_charts?.financial_performance_4q?.[0]?.distributions !== undefined ? `$${value}` : `${value}B`} />
                    <RechartsTooltip 
                      contentStyle={{ borderRadius: '8px', border: '1px solid #e5e5e4', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                      formatter={(value: number, name: string) => name === 'Distributions' ? [`$${value}`, name] : [`$${value}B`, name]}
                    />
                    <Legend iconType="circle" wrapperStyle={{ fontSize: '12px', paddingTop: '20px' }} />
                    {data.financial_charts.financial_performance_4q && data.financial_charts.financial_performance_4q.length > 0 && data.financial_charts.financial_performance_4q[0].distributions !== undefined ? (
                      <Bar dataKey="distributions" name="Distributions" fill="#10b981" radius={[4, 4, 0, 0]} barSize={48} />
                    ) : (
                      <>
                        <Bar dataKey="revenue" name="Revenue" fill="#3b82f6" radius={[4, 4, 0, 0]} barSize={32} />
                        <Bar dataKey="net_income" name="Net Income" fill="#1e3a8a" radius={[4, 4, 0, 0]} barSize={32} />
                      </>
                    )}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </AnalysisCard>
          </div>
        )}

        {/* Deep Insights */}
        {deepInsights.length > 0 && (
          <div className="mt-8 print:mt-6 print:mb-6">
            <h2 className="text-2xl font-display font-bold text-stone-900 uppercase tracking-wider mb-6 print:mb-4 print:break-after-avoid">Deep Insights</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 print:grid-cols-3 print:gap-4">
              {deepInsights.slice(0, 3).map((insight, index) => (
                <div key={index} className="bg-white p-6 rounded-xl border border-stone-200 shadow-sm flex flex-col print:break-inside-avoid print:shadow-none print:border-stone-300">
                   <div className="flex items-start justify-between mb-4 border-b border-stone-100 pb-4 print:border-stone-200">
                     <div className="flex items-center gap-3">
                       <div>
                         <div className="text-xs text-stone-500 font-bold uppercase tracking-wider">{insight.category}</div>
                         <h4 className="font-bold text-stone-900 text-lg mt-0.5 leading-tight">{insight.title}</h4>
                       </div>
                     </div>
                   </div>
                   <FormattedMarkdown content={insight.description} className="text-stone-700 leading-relaxed text-[15px] flex-1" />
                   <div className="mt-6 pt-4 border-t border-stone-100 flex items-center justify-between print:border-stone-200">
                     <span className="text-xs text-stone-500 font-bold uppercase tracking-wider">Impact Score</span>
                     <span className={`text-sm font-mono font-bold px-2 py-0.5 rounded ${insight.impact_score >= 8 ? 'bg-red-50 text-red-700 print:bg-red-100' : insight.impact_score >= 5 ? 'bg-yellow-50 text-yellow-700 print:bg-yellow-100' : 'bg-green-50 text-green-700 print:bg-green-100'}`}>{insight.impact_score}/10</span>
                   </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Detailed Findings */}
        <div className="mt-8 print:mt-6">
           <h2 className="text-2xl font-display font-bold text-stone-900 uppercase tracking-wider mb-6 print:mb-4 print:break-after-avoid">Document Findings</h2>
           
           {(() => {
             const validFindings = findings.filter(f => 
               f && (f.documentType || f.document_type || f.sourceUrl || f.source_url || (f.keyInsights && f.keyInsights.length > 0) || (f.key_insights && f.key_insights.length > 0))
             );

             if (validFindings.length === 0) {
               return (
                 <div className="text-stone-500 italic p-8 bg-white rounded border border-stone-200 text-center print:break-inside-avoid">
                   No specific document findings returned.
                 </div>
               );
             }

             return (
               <div className="flex flex-col gap-6 print:gap-4">
                 {validFindings.map((finding, index) => {
                   const docTitle = finding.documentType || finding.document_type || "Document";
                   const docUrl = finding.sourceUrl || finding.source_url;
                   const rawInsights = finding.keyInsights || finding.key_insights;
                   const insightsList = Array.isArray(rawInsights) ? rawInsights : rawInsights ? [String(rawInsights)] : [];

                   return (
                     <div key={index} className="bg-white p-6 rounded-xl border border-stone-200 shadow-sm flex flex-col print:break-inside-avoid print:shadow-none print:border-stone-300 print:mb-4">
                       <div className="flex items-start justify-between mb-4 border-b border-stone-100 pb-4 print:border-stone-200">
                         <div className="flex items-center gap-3">
                           <div className="w-10 h-10 rounded bg-stone-100 text-stone-700 flex items-center justify-center shrink-0 print:bg-stone-200">
                             <FileText className="w-5 h-5 text-stone-600" />
                           </div>
                           <div>
                             <h4 className="font-bold text-stone-900 text-lg">{docTitle}</h4>
                             {finding.date && (
                               <div className="text-xs text-stone-500 font-mono flex items-center gap-1 mt-1">
                                 <Calendar className="w-3 h-3" /> {finding.date}
                               </div>
                             )}
                             {docUrl && (
                               <div className="hidden print:block text-xs font-mono text-stone-600 underline break-all mt-1.5">
                                 Source: {docUrl}
                               </div>
                             )}
                           </div>
                         </div>
                         {docUrl && (
                           <a 
                             href={docUrl} 
                             target="_blank" 
                             rel="noreferrer" 
                             className="flex items-center gap-1.5 text-xs font-medium text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-md px-2.5 py-1.5 transition-colors shrink-0 print:hidden" 
                             title="View Source Document"
                           >
                             <FileText className="w-4 h-4 text-red-600 shrink-0" />
                             <span>View Source</span>
                             <LinkIcon className="w-3 h-3 text-red-500 shrink-0" />
                           </a>
                         )}
                       </div>
                       
                       {insightsList.length > 0 ? (
                         <ul className="space-y-3 mt-2 flex-1">
                           {insightsList.map((insight, i) => (
                             <li key={i} className="flex gap-2 text-sm text-stone-700 leading-relaxed print:break-inside-avoid">
                               <ChevronRight className="w-4 h-4 text-stone-400 mt-0.5 shrink-0" />
                               <FormattedMarkdown content={insight} className="flex-1" />
                             </li>
                           ))}
                         </ul>
                       ) : (
                         <div className="text-sm text-stone-400 italic mt-2">
                           No detailed bullet points extracted for this document.
                         </div>
                       )}
                     </div>
                   );
                 })}
               </div>
             );
           })()}
        </div>

      </div>
    </div>
  );
}
