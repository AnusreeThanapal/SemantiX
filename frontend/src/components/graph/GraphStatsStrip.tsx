import React from 'react';

export interface GraphStatsData {
  nodes: number;
  edges: number;
  direct: number;
  transitive: number;
  max_hop: number;
  files_affected: number;
}

interface GraphStatsStripProps {
  stats: GraphStatsData;
}

export const GraphStatsStrip: React.FC<GraphStatsStripProps> = ({ stats }) => {
  return (
    <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
      <div className="px-2.5 py-1 bg-[#090d16] border border-slate-800 rounded-md flex items-center space-x-1.5">
        <span className="text-slate-500">Impacted:</span>
        <span className="font-mono font-medium text-slate-200">{stats.nodes}</span>
      </div>

      <div className="px-2.5 py-1 bg-[#090d16] border border-slate-800 rounded-md flex items-center space-x-1.5">
        <span className="w-2 h-2 rounded-full bg-amber-400" />
        <span className="text-slate-500">Direct:</span>
        <span className="font-mono font-medium text-amber-300">{stats.direct}</span>
      </div>

      <div className="px-2.5 py-1 bg-[#090d16] border border-slate-800 rounded-md flex items-center space-x-1.5">
        <span className="w-2 h-2 rounded-full bg-violet-400" />
        <span className="text-slate-500">Transitive:</span>
        <span className="font-mono font-medium text-violet-300">{stats.transitive}</span>
      </div>

      <div className="px-2.5 py-1 bg-[#090d16] border border-slate-800 rounded-md flex items-center space-x-1.5">
        <span className="text-slate-500">Edges:</span>
        <span className="font-mono font-medium text-slate-200">{stats.edges}</span>
      </div>

      <div className="px-2.5 py-1 bg-[#090d16] border border-slate-800 rounded-md flex items-center space-x-1.5">
        <span className="text-slate-500">Max Depth:</span>
        <span className="font-mono font-medium text-cyan-400">{stats.max_hop} hops</span>
      </div>

      <div className="px-2.5 py-1 bg-[#090d16] border border-slate-800 rounded-md flex items-center space-x-1.5">
        <span className="text-slate-500">Files Affected:</span>
        <span className="font-mono font-medium text-slate-200">{stats.files_affected}</span>
      </div>
    </div>
  );
};
