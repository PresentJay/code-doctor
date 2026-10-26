import { createHash } from 'node:crypto';

export const revision = (text) => createHash('sha256').update(text).digest('hex');

export function makeReview(code, before, file) {
  // shortcut: fixture-only explanations; replace with grounded agent output before real repository use.
  const retry = code.includes('attempt < 3');
  const lines = code.trimEnd().split('\n');
  const returnLine = Math.max(1, lines.findIndex(line => line.includes('ok: false')) + 1);
  return {
    reviewId: 'profile-error-demo',
    task: 'Return an error the screen can use when loading a profile fails.',
    file, code, before, revision: revision(code),
    summary: retry
      ? 'The change returns an error and also retries the request up to three times.'
      : 'The example source changed. Compare the current and previous versions below.',
    blocks: [
      {
        id: 'retry-scope', title: retry ? 'Are retries needed?' : 'Read the revised code',
        relation: retry ? 'Beyond the original request' : 'Review after correction',
        explanation: retry
          ? 'The request was to return an error on failure. This loop adds two more attempts; removing it can preserve the error result.'
          : 'The original fixture explanation no longer applies. Check the source and tests for error handling and request counts.',
        start: retry ? 2 : 1, end: retry ? 10 : lines.length,
        suggested: retry ? 'Remove retries and keep the change that returns an error on failure.' : 'Check whether the revised source still returns an error.',
      },
      {
        id: 'error-result', title: 'Return the failure reason to the caller',
        relation: 'Part of the original request',
        explanation: 'Previously, failure returned null. Read the error result and check how the calling screen can use it.',
        start: returnLine, end: returnLine,
        suggested: 'Explain how the caller can use this error result.',
      },
    ],
  };
}

export function makeFeedback(review, liveCode, input) {
  if (input.revision !== review.revision || revision(liveCode) !== review.revision) {
    throw new Error('Code changed. Read the current source before leaving feedback.');
  }
  const block = review.blocks.find(item => item.id === input.blockId);
  if (!block) throw new Error('Unknown code block.');
  if (typeof input.text !== 'string' || !input.text.trim() || input.text.length > 4000) {
    throw new Error('Enter feedback between 1 and 4,000 characters.');
  }
  return {
    reviewId: review.reviewId, blockId: block.id, revision: review.revision,
    file: review.file, start: block.start, end: block.end,
    task: review.task, text: input.text.trim(), status: 'saved-not-sent',
  };
}

export function feedbackText(item) {
  return `# Feedback from the code reading connection probe\n\nOriginal request: ${item.task}\n\nFeedback: ${item.text}\n\nFile: ${item.file}\nBlock: ${item.blockId}\nLines: ${item.start}-${item.end}\nReview ID: ${item.reviewId}\nReviewed source SHA-256: ${item.revision}\n\nFirst compare the current file SHA-256. If it differs, read the changed source before applying feedback. Work only on the example file and distinguish questions from correction requests.\n`;
}
