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

  async getCommits(limit: number = 100, offset: number = 0): Promise<CommitSummary[]> {
    const res = await fetch(`${BASE_URL}/commits?limit=${limit}&offset=${offset}`);
    return handleResponse<CommitSummary[]>(res);
  },

  async getCommitImpact(sha: string, filePath?: string): Promise<ImpactSubgraphResult | ImpactSubgraphResult[]> {
    const url = filePath
      ? `${BASE_URL}/commits/${encodeURIComponent(sha)}/impact?file_path=${encodeURIComponent(filePath)}`
      : `${BASE_URL}/commits/${encodeURIComponent(sha)}/impact`;
    const res = await fetch(url);
    return handleResponse<ImpactSubgraphResult | ImpactSubgraphResult[]>(res);
  },

  async getCommitExplanation(sha: string, filePath?: string): Promise<ExplanationResult | ExplanationResult[]> {
    const url = filePath
      ? `${BASE_URL}/commits/${encodeURIComponent(sha)}/explanation?file_path=${encodeURIComponent(filePath)}`
      : `${BASE_URL}/commits/${encodeURIComponent(sha)}/explanation`;
    const res = await fetch(url);
    return handleResponse<ExplanationResult | ExplanationResult[]>(res);
  },

  async getHotspots(limit: number = 20): Promise<HotspotResult[]> {
    const res = await fetch(`${BASE_URL}/hotspots?limit=${limit}`);
    return handleResponse<HotspotResult[]>(res);
  },
};
