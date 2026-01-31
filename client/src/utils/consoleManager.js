/**
 * Console output management to prevent memory leaks
 * Implements circular buffer with configurable max lines
 */

const MAX_CONSOLE_LINES = 1000; // Keep last 1000 lines
const TRIM_TO_LINES = 800; // Trim to this when max reached

/**
 * Add line to console output with automatic trimming
 * @param {string[]} currentOutput - Current output array
 * @param {string} newLine - New line to add
 * @returns {string[]} Updated output array
 */
export function addConsoleOutput(currentOutput, newLine) {
  const updated = [...currentOutput, newLine];
  
  // Trim if exceeded max
  if (updated.length > MAX_CONSOLE_LINES) {
    return updated.slice(-TRIM_TO_LINES);
  }
  
  return updated;
}

/**
 * Batch add multiple lines (for efficiency)
 * @param {string[]} currentOutput - Current output array
 * @param {string[]} newLines - Array of new lines
 * @returns {string[]} Updated output array
 */
export function addConsoleOutputBatch(currentOutput, newLines) {
  const updated = [...currentOutput, ...newLines];
  
  if (updated.length > MAX_CONSOLE_LINES) {
    return updated.slice(-TRIM_TO_LINES);
  }
  
  return updated;
}

/**
 * Get console statistics
 * @param {string[]} output - Console output array
 * @returns {Object} Statistics object
 */
export function getConsoleStats(output) {
  const totalLines = output.length;
  const totalBytes = output.join('').length;
  const avgLineLength = totalLines > 0 ? totalBytes / totalLines : 0;
  
  return {
    totalLines,
    totalBytes,
    avgLineLength: Math.round(avgLineLength),
    nearLimit: totalLines > MAX_CONSOLE_LINES * 0.8
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
        matchIndex: line.toLowerCase().indexOf(lowerSearch)
      });
    }
  });
  
  return matches;
}
