import { RetryableProcessExitProof } from '../../shared/child-process/retryable-process-exit-proof'

/** A transport child can exit while the provider it controls remains alive. */
export function createCodexExecutionExitProof(
  confirm?: () => Promise<boolean>
): () => Promise<boolean> {
  const proof = new RetryableProcessExitProof()
  return () =>
    proof.run(async () => {
      if (!confirm) {
        return true
      }
      try {
        return (await confirm()) === true
      } catch {
        return false
      }
    })
}
