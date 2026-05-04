function extractUniqueResources(rows = []) {
  return [...new Set((rows || []).map(row => String(row?.resource || '').toLowerCase()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
}

module.exports = {
  extractUniqueResources,
};
