import React, { useState, useMemo } from 'react';
import { Download, ArrowUpDown } from 'lucide-react';
import { downloadCSV } from './exporters';

interface ImpactTableNode {
  id: string;
  label?: string;
  node_type?: string;
  file?: string;
  hop?: number;
  in_degree?: number;
  out_degree?: number;
  codeBertScore?: number | null;
  codeBertPercentile?: number | null;
}

interface ImpactTableProps {
  nodes: ImpactTableNode[];
  onSelectNodeAndOrbit: (nodeId: string) => void;
  onExportCSV?: () => void;
}

type SortColumn = 'symbol' | 'type' | 'file' | 'hop' | 'in_degree' | 'out_degree' | 'codebert';

export const ImpactTable: React.FC<ImpactTableProps> = ({
  nodes,
  onSelectNodeAndOrbit,
  onExportCSV,
}) => {
  const [sortCol, setSortCol] = useState<SortColumn>('hop');
  const [sortAsc, setSortAsc] = useState<boolean>(true);

  const hasCodeBert = useMemo(
    () => nodes.some((n) => n.codeBertScore !== undefined && n.codeBertScore !== null),
    [nodes]
  );

  const handleSort = (col: SortColumn) => {
    if (sortCol === col) {
      setSortAsc(!sortAsc);
    } else {
      setSortCol(col);
      setSortAsc(col === 'symbol' || col === 'type' || col === 'file');
    }
  };

  const sortedNodes = useMemo(() => {
    const list = [...nodes];
    list.sort((a, b) => {
      let vA: any;
      let vB: any;
      if (sortCol === 'symbol') {
        vA = a.label || a.id;
        vB = b.label || b.id;
      } else if (sortCol === 'type') {
        vA = a.node_type || '';
        vB = b.node_type || '';
      } else if (sortCol === 'file') {
        vA = a.file || '';
        vB = b.file || '';
      } else if (sortCol === 'hop') {
        vA = a.hop ?? 999;
        vB = b.hop ?? 999;
      } else if (sortCol === 'in_degree') {
        vA = a.in_degree ?? 0;
        vB = b.in_degree ?? 0;
      } else if (sortCol === 'out_degree') {
        vA = a.out_degree ?? 0;
        vB = b.out_degree ?? 0;
      } else if (sortCol === 'codebert') {
        vA = a.codeBertScore ?? -1;
        vB = b.codeBertScore ?? -1;
      }

      if (vA < vB) return sortAsc ? -1 : 1;
      if (vA > vB) return sortAsc ? 1 : -1;
      return 0;
    });
    return list;
  }, [nodes, sortCol, sortAsc]);

  const handleExport = () => {
    if (onExportCSV) {
      onExportCSV();
    } else {
      const rows = sortedNodes.map((n) => ({
        id: n.id,
        symbol: n.label || n.id,
        type: n.node_type || 'unknown',
        file: n.file || '',
        hop: n.hop ?? 0,
        in_degree: n.in_degree ?? 0,
        out_degree: n.out_degree ?? 0,
        ...(hasCodeBert ? { codebert_score: n.codeBertScore ?? '' } : {}),
      }));
      downloadCSV('impact_nodes', rows);
    }
  };

  return (
    <div className="w-full flex flex-col space-y-3 p-4 text-xs">
      {/* Top Table Actions Bar */}
      <div className="flex items-center justify-between">
        <span className="text-slate-400 font-mono text-[11px]">
          Showing {sortedNodes.length} symbols in impact subgraph
        </span>
        <button
          onClick={handleExport}
          className="flex items-center space-x-1.5 px-3 py-1.5 bg-[#090d16] hover:bg-slate-800 text-slate-200 border border-slate-700 rounded-lg text-xs transition-colors"
        >
          <Download className="w-3.5 h-3.5 text-cyan-400" />
          <span>Export CSV</span>
        </button>
      </div>

      {/* Table Container */}
      <div className="border border-slate-800 rounded-xl overflow-x-auto max-h-[500px]">
        <table className="w-full text-left border-collapse">
          <thead className="bg-[#090d16] sticky top-0 z-10 border-b border-slate-800 text-[11px] text-slate-400">
            <tr>
              <th
                onClick={() => handleSort('symbol')}
                className="py-2.5 px-3 font-semibold cursor-pointer select-none hover:text-slate-200"
              >
                <div className="flex items-center space-x-1">
                  <span>Symbol</span>
                  <ArrowUpDown className="w-3 h-3 text-slate-500" />
                </div>
              </th>
              <th
                onClick={() => handleSort('type')}
                className="py-2.5 px-3 font-semibold cursor-pointer select-none hover:text-slate-200"
              >
                <div className="flex items-center space-x-1">
                  <span>Type</span>
                  <ArrowUpDown className="w-3 h-3 text-slate-500" />
                </div>
              </th>
              <th
                onClick={() => handleSort('hop')}
                className="py-2.5 px-3 font-semibold cursor-pointer select-none hover:text-slate-200"
              >
                <div className="flex items-center space-x-1">
                  <span>Hop Reach</span>
                  <ArrowUpDown className="w-3 h-3 text-slate-500" />
                </div>
              </th>
              <th
                onClick={() => handleSort('file')}
                className="py-2.5 px-3 font-semibold cursor-pointer select-none hover:text-slate-200"
              >
                <div className="flex items-center space-x-1">
                  <span>File</span>
                  <ArrowUpDown className="w-3 h-3 text-slate-500" />
                </div>
              </th>
              {hasCodeBert && (
                <th
                  onClick={() => handleSort('codebert')}
                  className="py-2.5 px-3 font-semibold text-right cursor-pointer select-none hover:text-slate-200"
                >
                  <div className="flex items-center justify-end space-x-1">
                    <span>CodeBERT</span>
                    <ArrowUpDown className="w-3 h-3 text-slate-500" />
                  </div>
                </th>
              )}
              <th
                onClick={() => handleSort('in_degree')}
                className="py-2.5 px-3 font-semibold text-right cursor-pointer select-none hover:text-slate-200"
              >
                <div className="flex items-center justify-end space-x-1">
                  <span>In-Deg</span>
                  <ArrowUpDown className="w-3 h-3 text-slate-500" />
                </div>
              </th>
              <th
                onClick={() => handleSort('out_degree')}
                className="py-2.5 px-3 font-semibold text-right cursor-pointer select-none hover:text-slate-200"
              >
                <div className="flex items-center justify-end space-x-1">
                  <span>Out-Deg</span>
                  <ArrowUpDown className="w-3 h-3 text-slate-500" />
                </div>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60 font-mono text-[11px]">
            {sortedNodes.map((n) => {
              const hopClass =
                n.hop === 0
                  ? 'text-cyan-400 bg-cyan-950/40 border-cyan-800'
                  : n.hop === 1
                  ? 'text-amber-400 bg-amber-950/40 border-amber-800'
                  : 'text-violet-400 bg-violet-950/40 border-violet-800';

              return (
                <tr
                  key={n.id}
                  onClick={() => onSelectNodeAndOrbit(n.id)}
                  className="bg-[#0f172a] hover:bg-slate-800/80 cursor-pointer transition-colors group"
                >
                  <td className="py-2 px-3 text-slate-200 group-hover:text-cyan-300 font-semibold truncate max-w-[200px]">
                    {n.label || n.id.split(':').pop() || n.id}
                  </td>
                  <td className="py-2 px-3 text-slate-400 capitalize">
                    {n.node_type || 'unknown'}
                  </td>
                  <td className="py-2 px-3">
                    <span className={`px-1.5 py-0.5 rounded border text-[10px] ${hopClass}`}>
                      {n.hop === 0 ? 'Changed (0)' : `${n.hop} ${n.hop === 1 ? 'Hop' : 'Hops'}`}
                    </span>
                  </td>
                  <td className="py-2 px-3 text-slate-400 truncate max-w-[240px]">
                    {n.file || '-'}
                  </td>
                  {hasCodeBert && (
                    <td className="py-2 px-3 text-right text-cyan-300 font-semibold">
                      {n.codeBertScore !== undefined && n.codeBertScore !== null
                        ? `${(n.codeBertScore * 100).toFixed(0)}%`
                        : '-'}
                    </td>
                  )}
                  <td className="py-2 px-3 text-right text-slate-300">
                    {n.in_degree ?? 0}
                  </td>
                  <td className="py-2 px-3 text-right text-slate-300">
                    {n.out_degree ?? 0}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
