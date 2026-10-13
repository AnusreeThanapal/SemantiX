import React, { useMemo } from 'react';
import { X, ArrowDownRight, ArrowUpRight, FileCode, Layers } from 'lucide-react';

interface NodeInspectorProps {
  node: {
    id: string;
    label?: string;
    node_type?: string;
    file?: string;
    hop?: number;
    in_degree?: number;
    out_degree?: number;
    codeBertScore?: number | null;
    codeBertPercentile?: number | null;
  };
  edges: Array<{
    source: string | any;
    target: string | any;
    relation?: string;
    synthetic?: boolean;
  }>;
  onSelectNode: (nodeId: string) => void;
  onClose: () => void;
}

export const NodeInspector: React.FC<NodeInspectorProps> = ({
  node,
  edges,
  onSelectNode,
  onClose,
}) => {
  const getSourceId = (e: any): string =>
    typeof e.source === 'object' && e.source !== null && 'id' in e.source
      ? String(e.source.id)
      : String(e.source);

  const getTargetId = (e: any): string =>
    typeof e.target === 'object' && e.target !== null && 'id' in e.target
      ? String(e.target.id)
      : String(e.target);

  const callers = useMemo(() => {
    const list: Array<{ id: string; relation: string; synthetic: boolean }> = [];
    const seen = new Set<string>();
    for (const e of edges) {
      if (getTargetId(e) === node.id) {
        const s = getSourceId(e);
        if (!seen.has(s)) {
          seen.add(s);
          list.push({
            id: s,
            relation: e.relation || (e.synthetic ? 'synthetic' : 'calls'),
            synthetic: !!e.synthetic,
          });
        }
      }
    }
    return list;
  }, [edges, node.id]);

  const callees = useMemo(() => {
    const list: Array<{ id: string; relation: string; synthetic: boolean }> = [];
    const seen = new Set<string>();
    for (const e of edges) {
      if (getSourceId(e) === node.id) {
        const t = getTargetId(e);
        if (!seen.has(t)) {
          seen.add(t);
          list.push({
            id: t,
            relation: e.relation || (e.synthetic ? 'synthetic' : 'calls'),
            synthetic: !!e.synthetic,
          });
        }
      }
    }
    return list;
  }, [edges, node.id]);

  const leafLabel = (id: string) => id.split(':').pop() || id;

  const hopColor =
    node.hop === 0
      ? 'text-cyan-400 bg-cyan-950/60 border-cyan-800'
      : node.hop === 1
      ? 'text-amber-400 bg-amber-950/60 border-amber-800'
      : 'text-violet-400 bg-violet-950/60 border-violet-800';

  const hopName =
    node.hop === 0 ? 'Changed (Root)' : node.hop === 1 ? 'Direct (1-Hop)' : `Transitive (${node.hop}-Hop)`;

  return (
    <div className="absolute top-0 right-0 bottom-0 w-84 max-w-full bg-[#090d16]/95 backdrop-blur-md border-l border-slate-800 p-4 z-20 overflow-y-auto shadow-2xl flex flex-col space-y-4 text-xs animate-in slide-in-from-right duration-200">
      {/* Drawer Header */}
      <div className="flex items-center justify-between pb-3 border-b border-slate-800">
        <div className="flex items-center space-x-2 text-slate-200 font-semibold">
          <Layers className="w-4 h-4 text-cyan-400" />
          <span>Symbol Inspector</span>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
          title="Close inspector"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Main Symbol Identifiers */}
      <div className="space-y-1.5">
        <div className="text-[10px] uppercase font-semibold tracking-wider text-slate-500">
          Symbol Identifier
        </div>
        <div className="p-2.5 bg-[#0f172a] border border-slate-800 rounded-lg font-mono text-[11px] text-cyan-300 break-all select-all">
          {node.id}
        </div>
      </div>

      {/* Attributes Grid */}
      <div className="grid grid-cols-2 gap-2 text-[11px]">
        <div className="p-2 bg-[#0f172a] border border-slate-800/80 rounded-lg space-y-1">
          <span className="text-slate-500 block">Type</span>
          <span className="font-mono text-slate-300 capitalize">{node.node_type || 'unknown'}</span>
        </div>

        <div className="p-2 bg-[#0f172a] border border-slate-800/80 rounded-lg space-y-1">
          <span className="text-slate-500 block">Impact Reach</span>
          <span className={`inline-block px-1.5 py-0.5 rounded border text-[10px] font-medium ${hopColor}`}>
            {hopName}
          </span>
        </div>

        <div className="p-2 bg-[#0f172a] border border-slate-800/80 rounded-lg space-y-1">
          <span className="text-slate-500 block">In-Degree (Callers)</span>
          <span className="font-mono font-medium text-slate-200">{node.in_degree ?? callers.length}</span>
        </div>

        <div className="p-2 bg-[#0f172a] border border-slate-800/80 rounded-lg space-y-1">
          <span className="text-slate-500 block">Out-Degree (Callees)</span>
          <span className="font-mono font-medium text-slate-200">{node.out_degree ?? callees.length}</span>
        </div>

        {node.codeBertScore !== undefined && node.codeBertScore !== null && (
          <div className="p-2 bg-[#0f172a] border border-cyan-800/50 rounded-lg col-span-2 space-y-0.5">
            <div className="flex items-center justify-between">
              <span className="text-cyan-400 font-medium">CodeBERT Score</span>
              <span className="font-mono font-bold text-cyan-300">
                {(node.codeBertScore * 100).toFixed(1)}%
              </span>
            </div>
            {node.codeBertPercentile !== undefined && node.codeBertPercentile !== null && (
              <span className="text-[10px] text-slate-400 block font-mono">
                {(node.codeBertPercentile * 100).toFixed(0)}th percentile
              </span>
            )}
          </div>
        )}
      </div>

      {/* File Path */}
      {node.file && (
        <div className="space-y-1">
          <span className="text-[10px] uppercase font-semibold tracking-wider text-slate-500 flex items-center space-x-1">
            <FileCode className="w-3 h-3" />
            <span>Defined in File</span>
          </span>
          <div className="p-2 bg-[#0f172a] border border-slate-800 rounded-lg font-mono text-[11px] text-slate-300 break-all">
            {node.file}
          </div>
        </div>
      )}

      {/* Callers (Incoming Edges) */}
      <div className="space-y-2 pt-1">
        <div className="flex items-center justify-between text-[11px]">
          <span className="font-semibold text-slate-400 flex items-center space-x-1">
            <ArrowDownRight className="w-3.5 h-3.5 text-cyan-400" />
            <span>Callers / Dependents</span>
          </span>
          <span className="px-1.5 py-0.2 rounded bg-slate-800 text-slate-400 font-mono text-[10px]">
            {callers.length}
          </span>
        </div>

        {callers.length === 0 ? (
          <p className="text-[11px] text-slate-600 italic pl-1">No incoming edges in active graph</p>
        ) : (
          <div className="space-y-1 max-h-36 overflow-y-auto pr-1">
            {callers.map((c) => (
              <button
                key={c.id}
                onClick={() => onSelectNode(c.id)}
                className="w-full flex items-center justify-between p-1.5 bg-[#0f172a] hover:bg-slate-800/80 border border-slate-800/80 rounded text-left transition-colors group"
              >
                <span className="font-mono text-slate-300 group-hover:text-cyan-300 truncate pr-2">
                  {leafLabel(c.id)}
                </span>
                <span className="text-[10px] px-1 py-0.2 rounded bg-slate-800 text-slate-400 shrink-0">
                  {c.relation}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Callees (Outgoing Edges) */}
      <div className="space-y-2 pt-1">
        <div className="flex items-center justify-between text-[11px]">
          <span className="font-semibold text-slate-400 flex items-center space-x-1">
            <ArrowUpRight className="w-3.5 h-3.5 text-violet-400" />
            <span>Callees / Dependencies</span>
          </span>
          <span className="px-1.5 py-0.2 rounded bg-slate-800 text-slate-400 font-mono text-[10px]">
            {callees.length}
          </span>
        </div>

        {callees.length === 0 ? (
          <p className="text-[11px] text-slate-600 italic pl-1">No outgoing edges in active graph</p>
        ) : (
          <div className="space-y-1 max-h-36 overflow-y-auto pr-1">
            {callees.map((c) => (
              <button
                key={c.id}
                onClick={() => onSelectNode(c.id)}
                className="w-full flex items-center justify-between p-1.5 bg-[#0f172a] hover:bg-slate-800/80 border border-slate-800/80 rounded text-left transition-colors group"
              >
                <span className="font-mono text-slate-300 group-hover:text-cyan-300 truncate pr-2">
                  {leafLabel(c.id)}
                </span>
                <span className="text-[10px] px-1 py-0.2 rounded bg-slate-800 text-slate-400 shrink-0">
                  {c.relation}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
