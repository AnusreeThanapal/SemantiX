/**
 * Single API client module for SemantiX backend services.
 */

const BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

export interface AnalyzeRepoParams {
  repo_url_or_path: string;
  commit_depth?: number;
  hop_limit?: number;
}

export interface AnalyzeRepoResult {
  job_id: string;
  status: string;
}

export interface JobStatusResult {
  job_id: string;
  status: 'pending' | 'running' | 'complete' | 'failed';
  created_at: string;
  completed_at?: string | null;
  error?: string | null;
}

export interface CommitSummary {
  sha: string;
  author: string;
  timestamp: string;
  message: string;
  change_type: string;
  risk_level: string;
}

export interface ImpactSubgraphResult {
  commit_sha?: string;
  file_path?: string;
  changed_node: string;
  direct_impacts: string[];
  transitive_impacts: string[];
}

export interface ExplanationResult {
  commit_sha: string;
  file_path?: string;
  summary: string;
  why_it_matters: string;
  affected_count: number;
  risk_level: 'low' | 'medium' | 'high' | 'critical';
}

export interface HotspotResult {
  module: string;
  semantic_churn_count: number;
}

export interface ImpactNodeDetail {
  id: string;
  label: string;
  node_type: string;
  file: string;
  hop: number;
  in_degree: number;
  out_degree: number;
}

export interface ImpactEdgeDetail {
  source: string;
  target: string;
  relation: 'imports' | 'defines' | 'calls' | string;
  synthetic: boolean;
}

export interface ImpactDetailedResult {
  commit_sha: string;
  changed_node: string;
  hop_limit: number;
  nodes: ImpactNodeDetail[];
  edges: ImpactEdgeDetail[];
  stats: {
    nodes: number;
    edges: number;
    direct: number;
    transitive: number;
    max_hop: number;
    files_affected: number;
    top_hub: string | null;
  };
  warnings: string[];
}

export interface CodeBertStatus {
  state: 'disabled' | 'unloaded' | 'loading' | 'ready' | 'fallback' | 'error' | string;
  kind: 'codebert' | 'fallback-heuristic' | string;
  model_name?: string;
  device?: string;
  dim?: number;
  message?: string;
}

export interface CodeBertInsights {
  commit_sha: string;
  status: string;
  engine?: {
    name?: string;
    kind?: string;
    device?: string;
    dim?: number;
  };
  node_scores: Record<string, { semantic_score: number; percentile: number }>;
  drift: {
    file: string;
    cosine: number | null;
    drift: number | null;
    level?: string;
  }[];
  latent_dependencies: {
    id: string;
    label: string;
    file: string;
    node_type: string;
    score: number;
    percentile: number;
  }[];
  warnings: string[];
  message?: string;
  timings_ms?: { total: number };
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let errorMsg = `API Request failed with status ${response.status}`;
    try {
      const errorData = await response.json();
      if (errorData.detail) {
        errorMsg = typeof errorData.detail === 'string' ? errorData.detail : JSON.stringify(errorData.detail);
      }
    } catch {
      // Use default error string
    }
    throw new Error(errorMsg);
  }
  return response.json();
}

export const api = {
  async analyzeRepo(params: AnalyzeRepoParams): Promise<AnalyzeRepoResult> {
    const res = await fetch(`${BASE_URL}/repos/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repo_url_or_path: params.repo_url_or_path,
        commit_depth: params.commit_depth || 100,
        hop_limit: params.hop_limit || 3,
      }),
    });
    return handleResponse<AnalyzeRepoResult>(res);
  },

  async getJobStatus(jobId: string): Promise<JobStatusResult> {
    const res = await fetch(`${BASE_URL}/jobs/${jobId}`);
    return handleResponse<JobStatusResult>(res);
  },

  async getCommits(jobId: string, limit: number = 100, offset: number = 0): Promise<CommitSummary[]> {
    const params = new URLSearchParams({
      job_id: jobId,
      limit: String(limit),
      offset: String(offset),
    });
    const res = await fetch(`${BASE_URL}/commits?${params}`);
    return handleResponse<CommitSummary[]>(res);
  },

  async getCommitImpact(
    jobId: string,
    sha: string,
    filePath?: string,
  ): Promise<ImpactSubgraphResult | ImpactSubgraphResult[]> {
    const params = new URLSearchParams({ job_id: jobId });
    if (filePath) params.set('file_path', filePath);
    const url = `${BASE_URL}/commits/${encodeURIComponent(sha)}/impact?${params}`;
    const res = await fetch(url);
    return handleResponse<ImpactSubgraphResult | ImpactSubgraphResult[]>(res);
  },

  async getCommitExplanation(
    jobId: string,
    sha: string,
    filePath?: string,
  ): Promise<ExplanationResult | ExplanationResult[]> {
    const params = new URLSearchParams({ job_id: jobId });
    if (filePath) params.set('file_path', filePath);
    const url = `${BASE_URL}/commits/${encodeURIComponent(sha)}/explanation?${params}`;
    const res = await fetch(url);
    return handleResponse<ExplanationResult | ExplanationResult[]>(res);
  },

  async getHotspots(jobId: string, limit: number = 20): Promise<HotspotResult[]> {
    const params = new URLSearchParams({ job_id: jobId, limit: String(limit) });
    const res = await fetch(`${BASE_URL}/hotspots?${params}`);
    return handleResponse<HotspotResult[]>(res);
  },

  async getCommitImpactDetailed(sha: string, hops: number = 3): Promise<ImpactDetailedResult> {
    const url = `${BASE_URL}/commits/${encodeURIComponent(sha)}/impact/detailed?hops=${hops}`;
    const res = await fetch(url);
    return handleResponse<ImpactDetailedResult>(res);
  },

  async getCodeBertStatus(): Promise<CodeBertStatus> {
    const res = await fetch(`${BASE_URL}/codebert/status`);
    return handleResponse<CodeBertStatus>(res);
  },

  async warmupCodeBert(): Promise<CodeBertStatus> {
    const res = await fetch(`${BASE_URL}/codebert/warmup`, {
      method: 'POST',
    });
    return handleResponse<CodeBertStatus>(res);
  },

  async getCodeBertInsights(sha: string, hops: number = 3, latentK: number = 8): Promise<CodeBertInsights> {
    const url = `${BASE_URL}/commits/${encodeURIComponent(sha)}/impact/codebert?hops=${hops}&latent_k=${latentK}`;
    const res = await fetch(url);
    return handleResponse<CodeBertInsights>(res);
  },
};
