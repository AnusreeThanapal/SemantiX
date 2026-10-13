import React, { useState } from 'react';
import type { GraphFiltersState } from './graphUtils';
import { ChevronDown, SlidersHorizontal, RotateCcw } from 'lucide-react';

interface GraphFiltersProps {
  filters: GraphFiltersState;
  onChange: (filters: GraphFiltersState) => void;
  availableRelations: string[];
  availableNodeTypes: string[];
  totalNodesCount?: number;
  visibleNodesCount?: number;
}

export const GraphFilters: React.FC<GraphFiltersProps> = ({
  filters,
  onChange,
  availableRelations,
  availableNodeTypes,
  totalNodesCount,
  visibleNodesCount,
}) => {
  const [isOpen, setIsOpen] = useState(false);

  const handleDepthChange = (depth: 1 | 2 | 3) => {
    onChange({ ...filters, maxHop: depth });
  };

  const handleDirectionChange = (direction: 'both' | 'dependents' | 'dependencies') => {
    onChange({ ...filters, direction });
  };

  const handleToggleRelation = (rel: string) => {
    const next = new Set(filters.relations);
    if (next.has(rel)) {
      next.delete(rel);
    } else {
      next.add(rel);
    }
    onChange({ ...filters, relations: next });
  };

  const handleToggleNodeType = (type: string) => {
    const next = new Set(filters.nodeTypes);
    if (next.has(type)) {
      next.delete(type);
    } else {
      next.add(type);
    }
    onChange({ ...filters, nodeTypes: next });
  };

  const handleToggleHideOrphans = () => {
    onChange({ ...filters, hideOrphans: !filters.hideOrphans });
  };

  const handleReset = () => {
    onChange({
      maxHop: 3,
      relations: new Set(availableRelations),
      nodeTypes: new Set(availableNodeTypes),
      direction: 'both',
      hideOrphans: false,
    });
  };

  const isFiltered =
    filters.maxHop !== 3 ||
    filters.direction !== 'both' ||
    filters.hideOrphans ||
    filters.relations.size !== availableRelations.length ||
    filters.nodeTypes.size !== availableNodeTypes.length;

  return (
    <div className="bg-[#0f172a] border border-slate-800/80 rounded-xl overflow-hidden transition-all text-xs">
      {/* Collapsible Header */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-[#0f172a] hover:bg-slate-800/50 transition-colors text-slate-300"
      >
        <div className="flex items-center space-x-2.5">
          <SlidersHorizontal className="w-4 h-4 text-cyan-400" />
          <span className="font-semibold text-slate-200">Graph Filters</span>
          {isFiltered && (
            <span className="px-1.5 py-0.5 rounded text-[10px] bg-cyan-950 text-cyan-400 border border-cyan-800 font-medium">
              Active
            </span>
          )}
          {totalNodesCount !== undefined && visibleNodesCount !== undefined && (
            <span className="text-slate-500 text-[11px]">
              ({visibleNodesCount} of {totalNodesCount} nodes visible)
            </span>
          )}
        </div>
        <div className="flex items-center space-x-2 text-slate-400">
          <ChevronDown
            className={`w-4 h-4 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
          />
        </div>
      </button>

      {/* Collapsible Panel Content */}
      {isOpen && (
        <div className="px-4 pb-4 pt-2 border-t border-slate-800/60 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* 1. Depth Limit */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">
                Max Reach Depth
              </label>
              <div className="flex items-center bg-[#090d16] p-1 border border-slate-800 rounded-lg">
                {([1, 2, 3] as const).map((depth) => (
                  <button
                    key={depth}
                    onClick={() => handleDepthChange(depth)}
                    className={`flex-1 py-1 rounded text-center font-medium transition-all ${
                      filters.maxHop === depth
                        ? 'bg-cyan-950 text-cyan-400 border border-cyan-500/50 shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {depth} {depth === 1 ? 'Hop' : 'Hops'}
                  </button>
                ))}
              </div>
            </div>

            {/* 2. Propagation Direction */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">
                Direction
              </label>
              <div className="flex items-center bg-[#090d16] p-1 border border-slate-800 rounded-lg">
                {(
                  [
                    { id: 'both', label: 'Both' },
                    { id: 'dependents', label: 'Callers' },
                    { id: 'dependencies', label: 'Callees' },
                  ] as const
                ).map((d) => (
                  <button
                    key={d.id}
                    onClick={() => handleDirectionChange(d.id)}
                    className={`flex-1 py-1 rounded text-center font-medium transition-all ${
                      filters.direction === d.id
                        ? 'bg-cyan-950 text-cyan-400 border border-cyan-500/50 shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 3. Edge Relations */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">
                Edge Relations
              </label>
              <div className="flex flex-wrap gap-2 pt-0.5">
                {availableRelations.map((rel) => {
                  const checked = filters.relations.has(rel);
                  return (
                    <label
                      key={rel}
                      className={`inline-flex items-center space-x-1.5 px-2 py-1 rounded border cursor-pointer select-none transition-colors ${
                        checked
                          ? 'bg-cyan-950/40 text-cyan-300 border-cyan-800/80'
                          : 'bg-[#090d16] text-slate-500 border-slate-800 hover:text-slate-300'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => handleToggleRelation(rel)}
                        className="hidden"
                      />
                      <span className="capitalize">{rel}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* 4. Node Types & Orphan Option */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">
                Node Types & Clean
              </label>
              <div className="flex flex-wrap gap-2 pt-0.5">
                {availableNodeTypes.map((type) => {
                  const checked = filters.nodeTypes.has(type);
                  return (
                    <label
                      key={type}
                      className={`inline-flex items-center space-x-1.5 px-2 py-1 rounded border cursor-pointer select-none transition-colors ${
                        checked
                          ? 'bg-cyan-950/40 text-cyan-300 border-cyan-800/80'
                          : 'bg-[#090d16] text-slate-500 border-slate-800 hover:text-slate-300'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => handleToggleNodeType(type)}
                        className="hidden"
                      />
                      <span className="capitalize">{type}</span>
                    </label>
                  );
                })}

                <label
                  className={`inline-flex items-center space-x-1.5 px-2 py-1 rounded border cursor-pointer select-none transition-colors ${
                    filters.hideOrphans
                      ? 'bg-amber-950/40 text-amber-300 border-amber-800/80'
                      : 'bg-[#090d16] text-slate-500 border-slate-800 hover:text-slate-300'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={filters.hideOrphans}
                    onChange={handleToggleHideOrphans}
                    className="hidden"
                  />
                  <span>Hide Orphans</span>
                </label>
              </div>
            </div>
          </div>

          {/* Reset Filters action */}
          {isFiltered && (
            <div className="flex justify-end pt-1">
              <button
                onClick={handleReset}
                className="flex items-center space-x-1 text-slate-400 hover:text-cyan-400 text-[11px] transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset to default filters</span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
