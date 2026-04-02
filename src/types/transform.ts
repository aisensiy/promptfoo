export interface TransformContext {
  vars?: Record<string, unknown>;
  prompt?:
    | { label?: string; id?: string; raw?: string; display?: string }
    | Record<string, unknown>;
  metadata?: Record<string, unknown>;
  uuid?: string;
  [key: string]: unknown;
}

/**
 * A function that transforms output or vars at various stages of the evaluation pipeline.
 * Supported when using promptfoo as a Node.js package.
 */
export type TransformFunction = (
  output: string | object,
  context: TransformContext,
) => string | object | Promise<string | object>;
