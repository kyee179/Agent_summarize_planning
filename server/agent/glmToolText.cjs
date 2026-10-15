/**
 * Accept a whole JSON tool-call envelope emitted in GLM content instead of tool_calls.
 * Ordinary prose, extra keys, multiple calls, and embedded JSON are never executable.
 * Runtime tool allowlists, argument validators, state checks and budgets still apply.
 */
function parseToolText(content, turn) {
  if (typeof content !== 'string') return null;
  let text = content.trim();
  const fence = text.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/);
  if (fence) text = fence[1].trim();
  let value; try { value = JSON.parse(text); } catch { return null; }
  if (!value || Array.isArray(value) || typeof value !== 'object') return null;
  const keys = Object.keys(value).sort().join(',');
  if (!['arguments,name', 'name,parameters'].includes(keys) || typeof value.name !== 'string' || !/^[a-z_]{1,128}$/.test(value.name)) return null;
  const args = Object.hasOwn(value, 'arguments') ? value.arguments : value.parameters;
  if (!args || Array.isArray(args) || typeof args !== 'object') return null;
  return { id: `glm-json:${turn}`, name: value.name, arguments: JSON.stringify(args) };
}
module.exports = { parseToolText };
