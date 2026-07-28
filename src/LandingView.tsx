import React from 'react';
import { Scale, ShieldAlert, FileText, CheckCircle2 } from 'lucide-react';

export function LandingView() {
  return (
    <div className="absolute inset-0 flex items-center justify-center p-8 overflow-y-auto no-scrollbar ">
      <div className="relative z-10 w-full max-w-4xl mx-auto flex flex-col items-center py-12">
        {/* Header */}
        <div className="text-center mb-16 max-w-3xl">
          <h1 className="text-4xl md:text-5xl font-bold text-white tracking-tight mb-4 font-serif">
            Legal Advisor, your intelligent <span className="italic font-serif">legal & compliance</span> assistant
          </h1>
          <p className="text-lg text-[#b3b3b3] font-medium">
            Automatically researches court dockets, statutory regulations, contract clauses, and SEC legal disclosures.
          </p>
        </div>

        {/* Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full">
          
          {/* Card 1: Documents */}
          <div className="bg-black/20 backdrop-blur-md border border-white/10 rounded-none p-6 shadow-2xl flex flex-col hover:bg-black/30 transition-colors">
            <h3 className="text-xl font-medium text-white mb-6 text-left">
              Comprehensive legal document coverage.
            </h3>
            
            <div className="flex-1 flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-white"><FileText className="w-4 h-4" /></div>
                <div className="flex-1">
                  <div className="text-sm font-medium text-white">Court Filings & Precedents</div>
                  <div className="text-xs text-white/60">Judicial dockets, opinions, and motions</div>
                </div>
              </div>
              <div className="w-full h-px bg-white/10 my-1"></div>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-white"><Scale className="w-4 h-4" /></div>
                <div className="flex-1">
                  <div className="text-sm font-medium text-white">Statutory & Regulatory Frameworks</div>
                  <div className="text-xs text-white/60">GDPR, EU AI Act, Securities & Labor Law</div>
                </div>
              </div>
              <div className="w-full h-px bg-white/10 my-1"></div>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-white"><ShieldAlert className="w-4 h-4" /></div>
                <div className="flex-1">
                  <div className="text-sm font-medium text-white">Contracts & SEC Legal Item 3</div>
                  <div className="text-xs text-white/60">Liability caps, indemnities & legal proceedings</div>
                </div>
              </div>
            </div>
          </div>

          {/* Card 2: Analysis */}
          <div className="bg-black/20 backdrop-blur-md border border-white/10 rounded-none p-6 shadow-2xl flex flex-col hover:bg-black/30 transition-colors">
            <h3 className="text-xl font-medium text-white mb-6 text-left">
              Deep legal insights pulled directly from sources.
            </h3>
            
            <div className="flex-1 flex flex-col gap-4 justify-center">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="w-5 h-5 text-[#b3b3b3] shrink-0" />
                <div className="text-sm text-white/90 font-medium">Audit contract liability and compliance gaps</div>
              </div>
              <div className="w-full h-px bg-white/10"></div>
              <div className="flex items-center gap-3">
                <CheckCircle2 className="w-5 h-5 text-[#b3b3b3] shrink-0" />
                <div className="text-sm text-white/90 font-medium">Assess litigation exposure & defense strength</div>
              </div>
              <div className="w-full h-px bg-white/10"></div>
              <div className="flex items-center gap-3">
                <CheckCircle2 className="w-5 h-5 text-[#b3b3b3] shrink-0" />
                <div className="text-sm text-white/90 font-medium">Synthesize case law and regulations into actionable advice</div>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

