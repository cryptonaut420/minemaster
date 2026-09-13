/**
 * Console output management to prevent memory leaks
 * Implements circular buffer with configurable max lines
 */

const MAX_CONSOLE_LINES = 1000;
const MAX_CONSOLE_CHARS = 256 * 1024;
function bounded(output) {
  let count = 0;
  const result = [];
  for (
    let i = output.length - 1;
    i >= 0 && result.length < MAX_CONSOLE_LINES && count < MAX_CONSOLE_CHARS;
    i--
  ) {
    const chunk = String(output[i]).slice(-(MAX_CONSOLE_CHARS - count));
    count += chunk.length;
    result.push(chunk);
  }
  return result.reverse();
}
export function addConsoleOutput(output, chunk) {
  return bounded([
    ...output,
    ...(String(chunk).match(/[^\n]*\n|[^\n]+$/g) || []),
  ]);
}
export function addConsoleOutputBatch(output, chunks) {
  return addConsoleOutput(output, chunks.join(""));
}

/**
 * Get console statistics
 * @param {string[]} output - Console output array
 * @returns {Object} Statistics object
 */
export function getConsoleStats(output) {
  const totalLines = output.length;
  const totalBytes = output.join("").length;
  const avgLineLength = totalLines > 0 ? totalBytes / totalLines : 0;

  return {
    totalLines,
    totalBytes,
    avgLineLength: Math.round(avgLineLength),
    nearLimit: totalLines > MAX_CONSOLE_LINES * 0.8,
  };
}

/**
 * Search console output
 * @param {string[]} output - Console output array
 * @param {string} searchTerm - Term to search for
 * @returns {Object[]} Array of matches with line numbers
 */
export function searchConsole(output, searchTerm) {
  if (!searchTerm) return [];

  const matches = [];
  const lowerSearch = searchTerm.toLowerCase();

  output.forEach((line, index) => {
    if (line.toLowerCase().includes(lowerSearch)) {
      matches.push({
        lineNumber: index + 1,
        content: line,
        matchIndex: line.toLowerCase().indexOf(lowerSearch),
      });
    }
  });

  return matches;
}
