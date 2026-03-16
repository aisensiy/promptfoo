/**
 * Vision-based image grader for promptfoo.
 *
 * Resolves blob URIs to base64, sends the image to GPT-4o for visual
 * evaluation, and returns a GradingResult.
 *
 * Usage in promptfooconfig.yaml:
 *   assert:
 *     - type: javascript
 *       value: file://image-grader.cjs
 *       metric: visual-quality
 */

const https = require('https');
const { createRequire } = require('module');

// Build a require that can resolve from the project root so we can
// reach the compiled blob helpers in dist/.
const projectRequire = createRequire(require('path').join(__dirname, '..', '..', 'package.json'));

const BLOB_URI_RE = /^promptfoo:\/\/blob\/([a-f0-9]{64})$/i;

async function resolveImageBase64(output) {
  if (typeof output !== 'string') {
    return null;
  }

  // Already a data URL
  if (output.startsWith('data:image/')) {
    const match = output.match(/^data:([^;]+);base64,(.+)$/);
    return match ? { mimeType: match[1], base64: match[2] } : null;
  }

  // Blob URI — resolve through the blob store
  const blobMatch = output.match(BLOB_URI_RE);
  if (blobMatch) {
    const { getBlobByHash } = projectRequire('./dist/src/blobs/index.js');
    const blob = await getBlobByHash(blobMatch[1]);
    return {
      mimeType: blob.metadata.mimeType || 'image/png',
      base64: blob.data.toString('base64'),
    };
  }

  return null;
}

function callVisionModel(imageBase64, mimeType, rubric) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is required for image grading');
  }

  const body = JSON.stringify({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `You are an expert image quality evaluator for marketing assets.
Evaluate the provided image against the rubric and return ONLY a JSON object:
{"pass": boolean, "score": number, "reason": string}
- score: 0.0 to 1.0
- pass: true if score >= 0.7
- reason: 1-3 sentence explanation`,
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: `Rubric: ${rubric}` },
          {
            type: 'image_url',
            image_url: {
              url: `data:${mimeType};base64,${imageBase64}`,
              detail: 'low',
            },
          },
        ],
      },
    ],
    max_tokens: 512,
    temperature: 0,
  });

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.openai.com',
        path: '/v1/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) {
              reject(new Error(parsed.error.message));
              return;
            }
            resolve(parsed.choices[0].message.content);
          } catch (e) {
            reject(new Error(`Failed to parse vision response: ${data.slice(0, 500)}`));
          }
        });
      },
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function parseGradingResponse(response) {
  const jsonMatch = response.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { pass: false, score: 0, reason: `Could not parse grading response: ${response}` };
  }
  try {
    const result = JSON.parse(jsonMatch[0]);
    return {
      pass: typeof result.pass === 'boolean' ? result.pass : (result.score || 0) >= 0.7,
      score: typeof result.score === 'number' ? result.score : result.pass ? 1 : 0,
      reason: result.reason || 'No reason provided',
    };
  } catch {
    return { pass: false, score: 0, reason: `Invalid JSON in grading response: ${response}` };
  }
}

/**
 * @param {string} output - The provider output (blob URI or data URL)
 * @param {object} context - Assertion context with vars, prompt, test, etc.
 * @returns {Promise<{pass: boolean, score: number, reason: string}>}
 */
module.exports = async function (output, context) {
  const service = context.vars?.service || 'home services';

  const rubric =
    `Evaluate this AI-generated image for use as a Thumbtack marketing asset ` +
    `for "${service}" services. Score 0.0-1.0 based on: ` +
    `(1) Visual quality — polished composition, good lighting, no artifacts. ` +
    `(2) Brand fit — warm, trustworthy, approachable feel for a home services marketplace. ` +
    `(3) Technical quality — no distorted hands, nonsensical objects, or uncanny faces. ` +
    `(4) Service relevance — clearly communicates "${service}" through visual cues.`;

  const image = await resolveImageBase64(output);
  if (!image) {
    return {
      pass: false,
      score: 0,
      reason: `Could not resolve image from output: ${String(output).slice(0, 100)}`,
    };
  }

  const response = await callVisionModel(image.base64, image.mimeType, rubric);
  return parseGradingResponse(response);
};
