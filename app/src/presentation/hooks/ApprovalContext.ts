import { createContext, useContext } from 'react';
import type { Approval } from '../../domain/entities/Approval';

export type ApprovalRunner = <T>(
  action: (approval: Approval | null) => Promise<T>,
  options: { reason: string },
) => Promise<T | null>;

export const ApprovalContext = createContext<ApprovalRunner | null>(null);

/**
 * Runs an action; if it throws PermissionDeniedError, asks for a manager PIN for exactly that
 * permission and re-runs it with the approval. Resolves null when the approval is cancelled.
 */
export function useApproval(): ApprovalRunner {
  const ctx = useContext(ApprovalContext);
  if (!ctx) throw new Error('ApprovalContext missing');
  return ctx;
}
